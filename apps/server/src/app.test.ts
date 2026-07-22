import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
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

function fakeHsd(overrides: Partial<{ status: boolean; balance: boolean }> = {}) {
  return {
    getStatus: vi.fn(async () => {
      if (overrides.status === false) throw new Error("unreachable");
      return {};
    }),
    getBalance: vi.fn(async () => {
      if (overrides.balance === false) throw new Error("unreachable");
      return {};
    }),
  } as never;
}

describe("GET /health", () => {
  it("always reports ok without touching hsd", async () => {
    const app = createApp(env, fakeHsd());
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("sends the CSP and frame-ancestors headers from spec §21.4", async () => {
    const app = createApp(env, fakeHsd());
    const res = await app.request("/health");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("GET /ready", () => {
  it("reports ready when node and wallet are reachable", async () => {
    const app = createApp(env, fakeHsd());
    const res = await app.request("/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ready: true, checks: { node: true, wallet: true } });
  });

  it("reports 503 and no sensitive data when hsd is unreachable", async () => {
    const app = createApp(env, fakeHsd({ status: false, balance: false }));
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
    const app = createApp(env, fakeHsd());
    const res = await app.request("http://localhost/health", undefined, fromPeer("127.0.0.1"));
    expect(res.status).toBe(200);
  });

  it("rejects plain HTTP from a remote peer, even if it spoofs a localhost Host header", async () => {
    const app = createApp(env, fakeHsd());
    const res = await app.request("http://localhost/health", undefined, fromPeer("203.0.113.5"));
    expect(res.status).toBe(403);
  });

  it("allows HTTPS from a remote peer", async () => {
    const app = createApp(env, fakeHsd());
    const res = await app.request(
      "https://wallet.example.com/health",
      undefined,
      fromPeer("203.0.113.5"),
    );
    expect(res.status).toBe(200);
  });

  it("under TRUST_PROXY, honors X-Forwarded-Proto regardless of peer address", async () => {
    const proxiedEnv = { ...env, TRUST_PROXY: true };
    const app = createApp(proxiedEnv, fakeHsd());

    const rejected = await app.request("http://wallet.example.com/health");
    expect(rejected.status).toBe(403);

    const accepted = await app.request("http://wallet.example.com/health", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(accepted.status).toBe(200);
  });
});
