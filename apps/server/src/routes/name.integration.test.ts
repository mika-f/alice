import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import type { Env } from "../env.js";
import { HsdConnectionManager } from "../services/hsd-connection-manager.js";
import { StatusPoller } from "../services/status-poller.js";

const NODE_URL = process.env.HSD_TEST_NODE_URL ?? "http://127.0.0.1:14037";
const WALLET_URL = process.env.HSD_TEST_WALLET_URL ?? "http://127.0.0.1:14039";
const API_KEY = process.env.HSD_TEST_API_KEY ?? "devkey";

async function probeAvailability(): Promise<boolean> {
  try {
    const res = await fetch(NODE_URL, {
      headers: { Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

const available = await probeAvailability();

const env: Env = {
  APP_URL: "http://localhost:3000",
  HOST: "0.0.0.0",
  PORT: 3000,
  TRUST_PROXY: false,
  DATABASE_URL: ":memory:",
  HSD_NODE_URL: NODE_URL,
  HSD_NODE_API_KEY: API_KEY,
  HSD_WALLET_URL: WALLET_URL,
  HSD_WALLET_API_KEY: API_KEY,
  HSD_WALLET_ID: "primary",
  HSD_NETWORK: "regtest",
  SESSION_SECRET: "x".repeat(32),
  ENCRYPTION_KEY: "y".repeat(32),
};

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

function buildApp() {
  const hsdManager = HsdConnectionManager.fromEnvOrDb(db, env);
  return createApp(env, hsdManager, db, new StatusPoller(hsdManager));
}

interface Jar {
  header(): string;
  absorb(res: Response): void;
}

function cookieJar(): Jar {
  const cookies = new Map<string, string>();
  return {
    header() {
      return Array.from(cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
    absorb(res: Response) {
      for (const setCookie of res.headers.getSetCookie?.() ?? []) {
        const [pair] = setCookie.split(";");
        const [name, value] = pair!.split("=");
        if (name && value !== undefined) cookies.set(name, value);
      }
    },
  };
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function req(
  app: ReturnType<typeof buildApp>,
  jar: Jar,
  method: string,
  path: string,
  csrf: string,
  body?: unknown,
) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.absorb(res);
  return res;
}

async function setUpAndLogIn(app: ReturnType<typeof buildApp>, jar: Jar) {
  const first = await app.request("/api/auth/session", { headers: { cookie: jar.header() } });
  jar.absorb(first);
  const csrf = jar.header().match(/csrf_token=([^;]+)/)![1]!;

  await req(app, jar, "POST", "/api/auth/setup", csrf, {
    username: "alice",
    password: "correct-horse-battery-staple",
  });

  return csrf;
}

describe.skipIf(!available)("name routes against a live regtest hsd", () => {
  it("lists names known to the wallet", async () => {
    const app = buildApp();
    const jar = cookieJar();
    await setUpAndLogIn(app, jar);

    const res = await app.request("/api/names", { headers: { cookie: jar.header() } });
    expect(res.status).toBe(200);
    const names = await readJson<{ name: string; state: string }[]>(res);
    expect(Array.isArray(names)).toBe(true);
  });

  it("reads a name's detail and lets a local label/memo be attached", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const names = await readJson<{ name: string; state: string }[]>(
      await app.request("/api/names", { headers: { cookie: jar.header() } }),
    );
    // "primary" accumulates real names from Phase 3 dev/testing against this long-running
    // regtest stack; skip gracefully on a completely fresh stack instead of asserting one exists.
    if (names.length === 0) return;

    const target = names[0]!;

    const detailRes = await app.request(`/api/names/${target.name}`, {
      headers: { cookie: jar.header() },
    });
    expect(detailRes.status).toBe(200);
    const detail = await readJson<{ name: string; nameHash: string; bids: unknown[] }>(detailRes);
    expect(detail.name).toBe(target.name);
    expect(typeof detail.nameHash).toBe("string");
    expect(Array.isArray(detail.bids)).toBe(true);

    const metaRes = await req(app, jar, "PUT", `/api/names/${target.name}/meta`, csrf, {
      label: "Integration test label",
    });
    expect(metaRes.status).toBe(204);

    const relistedRes = await app.request("/api/names", { headers: { cookie: jar.header() } });
    const relisted = await readJson<{ name: string; label?: string }[]>(relistedRes);
    expect(relisted.find((n) => n.name === target.name)?.label).toBe("Integration test label");
  });

  it("returns the decoded resource for a name via the dedicated endpoint", async () => {
    const app = buildApp();
    const jar = cookieJar();
    await setUpAndLogIn(app, jar);

    const names = await readJson<{ name: string; resourceSummary: string | null }[]>(
      await app.request("/api/names", { headers: { cookie: jar.header() } }),
    );
    const withResource = names.find((n) => n.resourceSummary !== null);
    if (!withResource) return;

    const res = await app.request(`/api/names/${withResource.name}/resource`, {
      headers: { cookie: jar.header() },
    });
    expect(res.status).toBe(200);
    const resource = await readJson<{ records: unknown[]; raw: string; size: number } | null>(res);
    expect(resource).not.toBeNull();
    expect(Array.isArray(resource?.records)).toBe(true);
  });
});
