import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import type { Env } from "../env.js";
import { HsdConnectionManager } from "../services/hsd-connection-manager.js";
import { RescanTracker } from "../services/rescan-tracker.js";
import { StatusPoller } from "../services/status-poller.js";

/** Runs against the regtest hsd started via `docker/compose.dev.yaml`; skipped otherwise. */
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
  HSD_NODE_URL: "http://127.0.0.1:1",
  HSD_NODE_API_KEY: "unused",
  HSD_WALLET_URL: "http://127.0.0.1:1",
  HSD_WALLET_API_KEY: "unused",
  HSD_WALLET_ID: "unused",
  HSD_NETWORK: "main",
  SESSION_SECRET: "x".repeat(32),
  ENCRYPTION_KEY: "y".repeat(32),
};

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

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

async function post(
  app: ReturnType<typeof createApp>,
  jar: Jar,
  path: string,
  csrf: string,
  body?: unknown,
) {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.absorb(res);
  return res;
}

async function setUpAndLogIn(app: ReturnType<typeof createApp>, jar: Jar) {
  const first = await app.request("/api/auth/session", { headers: { cookie: jar.header() } });
  jar.absorb(first);
  const csrf = jar.header().match(/csrf_token=([^;]+)/)![1]!;

  await post(app, jar, "/api/auth/setup", csrf, {
    username: "alice",
    password: "correct-horse-battery-staple",
  });

  return csrf;
}

describe.skipIf(!available)("connection routes against a live regtest hsd", () => {
  it("test reports success for a working connection", async () => {
    const hsdManager = HsdConnectionManager.fromEnvOrDb(db, env);
    const app = createApp(env, hsdManager, db, new StatusPoller(hsdManager), new RescanTracker());
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const res = await post(app, jar, "/api/connection/test", csrf, {
      displayName: "Regtest",
      nodeUrl: NODE_URL,
      walletUrl: WALLET_URL,
      nodeApiKey: API_KEY,
      walletApiKey: API_KEY,
      walletId: "primary",
      network: "regtest",
      timeoutMs: 5_000,
      tlsVerify: true,
    });

    expect(res.status).toBe(200);
    const body = await readJson<{
      authenticated: boolean;
      networkMatches: boolean;
      hsdVersion: string | null;
    }>(res);
    expect(body.authenticated).toBe(true);
    expect(body.networkMatches).toBe(true);
    expect(body.hsdVersion).toMatch(/^8\./);
  });

  it("PUT saves and immediately applies the new connection to /ready", async () => {
    const hsdManager = HsdConnectionManager.fromEnvOrDb(db, env);
    const app = createApp(env, hsdManager, db, new StatusPoller(hsdManager), new RescanTracker());
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const before = await app.request("/ready");
    expect((await readJson<{ ready: boolean }>(before)).ready).toBe(false);

    const putRes = await app.request("/api/connection", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({
        displayName: "Regtest",
        nodeUrl: NODE_URL,
        walletUrl: WALLET_URL,
        nodeApiKey: API_KEY,
        walletApiKey: API_KEY,
        walletId: "primary",
        network: "regtest",
        timeoutMs: 5_000,
        tlsVerify: true,
      }),
    });
    expect(putRes.status).toBe(200);
    const saved = await readJson<object>(putRes);
    expect(saved).not.toHaveProperty("nodeApiKey");

    const after = await app.request("/ready");
    expect((await readJson<{ ready: boolean }>(after)).ready).toBe(true);
  });

  it("PUT rejects a network mismatch and does not save or reconfigure", async () => {
    const hsdManager = HsdConnectionManager.fromEnvOrDb(db, env);
    const app = createApp(env, hsdManager, db, new StatusPoller(hsdManager), new RescanTracker());
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const putRes = await app.request("/api/connection", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({
        displayName: "Wrong network",
        nodeUrl: NODE_URL,
        walletUrl: WALLET_URL,
        nodeApiKey: API_KEY,
        walletApiKey: API_KEY,
        walletId: "primary",
        network: "testnet",
        timeoutMs: 5_000,
        tlsVerify: true,
      }),
    });
    expect(putRes.status).toBe(422);

    const after = await app.request("/ready");
    expect((await readJson<{ ready: boolean }>(after)).ready).toBe(false);
  });
});
