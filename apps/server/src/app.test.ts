import { HsdHttpError } from "@alice-hns-wallet/hsd-client";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { RescanTracker } from "./services/rescan-tracker.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import type { Env } from "./env.js";

const env: Env = {
  APP_URL: "http://localhost:3000",
  HOST: "0.0.0.0",
  PORT: 3000,
  TRUST_PROXY: false,
  DATABASE_URL: "./data/wallet.sqlite",
  HSD_NODE_URL: "http://hsd:12037",
  HSD_NODE_API_KEY: "node-key",
  HSD_WALLET_URL: "http://hsd:12039",
  HSD_WALLET_API_KEY: "wallet-key",
  HSD_WALLET_ID: "primary",
  HSD_NETWORK: "regtest",
  SESSION_SECRET: "x".repeat(32),
  ENCRYPTION_KEY: "y".repeat(32),
};

const rescanTracker = new RescanTracker();

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}

function fakeHsdManager(overrides: Partial<{ status: boolean; balance: boolean }> = {}) {
  const adapter = {
    getStatus: vi.fn(async () => {
      if (overrides.status === false) throw new Error("unreachable");
      return {};
    }),
    getBalance: vi.fn(async () => {
      if (overrides.balance === false) throw new Error("unreachable");
      return {};
    }),
  };
  return { get: () => adapter, getConnection: vi.fn(), reconfigure: vi.fn() } as never;
}

function fakeStatusPoller() {
  return {
    getSnapshot: vi.fn(() => ({
      node: null,
      nodeError: null,
      walletConnected: false,
      walletError: null,
      lastUpdated: 0,
    })),
  } as never;
}

describe("GET /health", () => {
  it("always reports ok without touching hsd", async () => {
    const app = createApp(env, fakeHsdManager(), freshDb(), fakeStatusPoller(), rescanTracker);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("sends the CSP and frame-ancestors headers from spec §21.4", async () => {
    const app = createApp(env, fakeHsdManager(), freshDb(), fakeStatusPoller(), rescanTracker);
    const res = await app.request("/health");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("GET /ready", () => {
  it("reports ready when node and wallet are reachable", async () => {
    const app = createApp(env, fakeHsdManager(), freshDb(), fakeStatusPoller(), rescanTracker);
    const res = await app.request("/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ready: true, checks: { node: true, wallet: true } });
  });

  it("reports 503 and no sensitive data when hsd is unreachable", async () => {
    const app = createApp(
      env,
      fakeHsdManager({ status: false, balance: false }),
      freshDb(),
      fakeStatusPoller(),
      rescanTracker,
    );
    const res = await app.request("/ready");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ready: false, checks: { node: false, wallet: false } });
  });
});

function fromPeer(remoteAddress: string) {
  return { incoming: { socket: { remoteAddress } } };
}

describe("HTTPS enforcement (spec §5.2)", () => {
  it("allows plain HTTP when the real TCP peer is loopback", async () => {
    const app = createApp(env, fakeHsdManager(), freshDb(), fakeStatusPoller(), rescanTracker);
    const res = await app.request("http://localhost/health", undefined, fromPeer("127.0.0.1"));
    expect(res.status).toBe(200);
  });

  it("rejects plain HTTP from a remote peer, even if it spoofs a localhost Host header", async () => {
    const app = createApp(env, fakeHsdManager(), freshDb(), fakeStatusPoller(), rescanTracker);
    const res = await app.request("http://localhost/health", undefined, fromPeer("203.0.113.5"));
    expect(res.status).toBe(403);
  });

  it("allows HTTPS from a remote peer", async () => {
    const app = createApp(env, fakeHsdManager(), freshDb(), fakeStatusPoller(), rescanTracker);
    const res = await app.request(
      "https://wallet.example.com/health",
      undefined,
      fromPeer("203.0.113.5"),
    );
    expect(res.status).toBe(200);
  });

  it("under TRUST_PROXY, honors X-Forwarded-Proto regardless of peer address", async () => {
    const proxiedEnv = { ...env, TRUST_PROXY: true };
    const app = createApp(
      proxiedEnv,
      fakeHsdManager(),
      freshDb(),
      fakeStatusPoller(),
      rescanTracker,
    );

    const rejected = await app.request("http://wallet.example.com/health");
    expect(rejected.status).toBe(403);

    const accepted = await app.request("http://wallet.example.com/health", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(accepted.status).toBe(200);
  });
});

describe("global error handling", () => {
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

  async function setUpAndLogIn(app: ReturnType<typeof createApp>, jar: Jar) {
    const first = await app.request("/api/auth/session", { headers: { cookie: jar.header() } });
    jar.absorb(first);
    const csrf = jar.header().match(/csrf_token=([^;]+)/)![1]!;

    const res = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ username: "alice", password: "correct-horse-battery-staple" }),
    });
    jar.absorb(res);
  }

  it("turns an uncaught HsdHttpError into a real JSON error message instead of Hono's default response", async () => {
    const hsdManager = {
      get: () => ({
        getBalance: vi.fn(async () => {
          throw new HsdHttpError(
            "hsd request failed: GET /wallet/primary/balance: Not found.",
            404,
          );
        }),
      }),
      getConnection: vi.fn(),
      reconfigure: vi.fn(),
    } as never;

    const app = createApp(env, hsdManager, freshDb(), fakeStatusPoller(), rescanTracker);
    const jar = cookieJar();
    await setUpAndLogIn(app, jar);

    const res = await app.request("/api/wallet/balance", { headers: { cookie: jar.header() } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "hsd request failed: GET /wallet/primary/balance: Not found.",
    });
  });

  it("hides an unexpected non-hsd error behind a generic message", async () => {
    const hsdManager = {
      get: () => ({
        getBalance: vi.fn(async () => {
          throw new Error("some internal bug with a stack trace nobody outside should see");
        }),
      }),
      getConnection: vi.fn(),
      reconfigure: vi.fn(),
    } as never;

    const app = createApp(env, hsdManager, freshDb(), fakeStatusPoller(), rescanTracker);
    const jar = cookieJar();
    await setUpAndLogIn(app, jar);

    const res = await app.request("/api/wallet/balance", { headers: { cookie: jar.header() } });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal server error" });
  });
});
