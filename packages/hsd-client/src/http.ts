import { Semaphore } from "./semaphore.js";

export class HsdHttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "HsdHttpError";
  }
}

export interface HsdHttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /** Maximum simultaneous in-flight requests against this endpoint (spec §22.1). */
  concurrency?: number;
}

/**
 * Thin fetch wrapper for hsd's node/wallet HTTP APIs.
 * hsd authenticates via HTTP Basic auth with an empty username and the API key as password.
 */
export class HsdHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly semaphore: Semaphore;

  constructor(options: HsdHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.semaphore = new Semaphore(options.concurrency ?? 4);
  }

  /** GET requests may be retried once; writes must never be retried (spec §22.2). */
  async get<T = unknown>(path: string, retry = true): Promise<T> {
    return this.semaphore.run(() => this.request<T>("GET", path, undefined, retry ? 1 : 0));
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.semaphore.run(() => this.request<T>("POST", path, body, 0));
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.semaphore.run(() => this.request<T>("PUT", path, body, 0));
  }

  /** JSON-RPC over the same HTTP endpoint (POST / with {method, params}); read-only calls may be retried once. */
  async rpc<T = unknown>(method: string, params: unknown[] = [], retry = true): Promise<T> {
    const body = await this.semaphore.run(() =>
      this.request<{ result: T; error: { message: string; code?: number } | null }>(
        "POST",
        "/",
        { method, params },
        retry ? 1 : 0,
      ),
    );
    if (body.error) {
      throw new HsdHttpError(`hsd rpc ${method} failed: ${body.error.message}`, body.error.code);
    }
    return body.result;
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    retriesLeft: number,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`:${this.apiKey}`).toString("base64")}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new HsdHttpError(`hsd request failed: ${method} ${path}`, response.status);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (retriesLeft > 0) {
        return this.request<T>(method, path, body, retriesLeft - 1);
      }
      if (error instanceof HsdHttpError) throw error;
      throw new HsdHttpError(`hsd request errored: ${method} ${path}: ${String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
