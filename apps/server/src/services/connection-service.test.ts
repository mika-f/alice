import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import type { Env } from "../env.js";
import {
  getActiveConnection,
  saveConnection,
  testConnection,
  toSafeConnection,
} from "./connection-service.js";

const ENCRYPTION_KEY = "z".repeat(32);

const env: Env = {
  APP_URL: "http://localhost:3000",
  HOST: "0.0.0.0",
  PORT: 3000,
  TRUST_PROXY: false,
  DATABASE_URL: ":memory:",
  HSD_NODE_URL: "http://env-node:12037",
  HSD_NODE_API_KEY: "env-node-key",
  HSD_WALLET_URL: "http://env-wallet:12039",
  HSD_WALLET_API_KEY: "env-wallet-key",
  HSD_WALLET_ID: "env-wallet-id",
  HSD_NETWORK: "main",
  SESSION_SECRET: "x".repeat(32),
  ENCRYPTION_KEY,
};

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

describe("getActiveConnection", () => {
  it("falls back to environment variables when nothing is stored", () => {
    const connection = getActiveConnection(db, env, ENCRYPTION_KEY);
    expect(connection.nodeUrl).toBe(env.HSD_NODE_URL);
    expect(connection.walletId).toBe(env.HSD_WALLET_ID);
    expect(connection.network).toBe("main");
  });

  it("prefers a saved connection over environment variables", () => {
    saveConnection(db, ENCRYPTION_KEY, {
      displayName: "Home server",
      nodeUrl: "http://saved-node:12037",
      walletUrl: "http://saved-wallet:12039",
      nodeApiKey: "saved-node-key",
      walletApiKey: "saved-wallet-key",
      walletId: "primary",
      network: "regtest",
      timeoutMs: 5_000,
      tlsVerify: true,
    });

    const connection = getActiveConnection(db, env, ENCRYPTION_KEY);
    expect(connection.nodeUrl).toBe("http://saved-node:12037");
    expect(connection.nodeApiKey).toBe("saved-node-key");
    expect(connection.network).toBe("regtest");
  });

  it("round-trips encrypted API keys correctly", () => {
    saveConnection(db, ENCRYPTION_KEY, {
      displayName: "Home server",
      nodeUrl: "http://saved-node:12037",
      walletUrl: "http://saved-wallet:12039",
      nodeApiKey: "top-secret-node-key",
      walletApiKey: "top-secret-wallet-key",
      walletId: "primary",
      network: "main",
      timeoutMs: 10_000,
      tlsVerify: true,
    });

    const connection = getActiveConnection(db, env, ENCRYPTION_KEY);
    expect(connection.nodeApiKey).toBe("top-secret-node-key");
    expect(connection.walletApiKey).toBe("top-secret-wallet-key");
  });

  it("overwrites the single stored connection on a second save", () => {
    saveConnection(db, ENCRYPTION_KEY, {
      displayName: "First",
      nodeUrl: "http://first:12037",
      walletUrl: "http://first:12039",
      nodeApiKey: "a",
      walletApiKey: "b",
      walletId: "primary",
      network: "main",
      timeoutMs: 10_000,
      tlsVerify: true,
    });
    saveConnection(db, ENCRYPTION_KEY, {
      displayName: "Second",
      nodeUrl: "http://second:12037",
      walletUrl: "http://second:12039",
      nodeApiKey: "c",
      walletApiKey: "d",
      walletId: "primary",
      network: "main",
      timeoutMs: 10_000,
      tlsVerify: true,
    });

    const connection = getActiveConnection(db, env, ENCRYPTION_KEY);
    expect(connection.displayName).toBe("Second");
    expect(connection.nodeUrl).toBe("http://second:12037");
  });
});

describe("toSafeConnection", () => {
  it("never includes API keys", () => {
    const connection = getActiveConnection(db, env, ENCRYPTION_KEY);
    const safe = toSafeConnection(connection);
    expect(safe).not.toHaveProperty("nodeApiKey");
    expect(safe).not.toHaveProperty("walletApiKey");
    expect(JSON.stringify(safe)).not.toContain(connection.nodeApiKey);
  });
});

describe("testConnection", () => {
  it("reports unreachable node and wallet with error details, no throw", async () => {
    const result = await testConnection({
      displayName: "Unreachable",
      nodeUrl: "http://127.0.0.1:1",
      walletUrl: "http://127.0.0.1:1",
      nodeApiKey: "x",
      walletApiKey: "x",
      walletId: "primary",
      network: "main",
      timeoutMs: 2_000,
      tlsVerify: true,
    });

    expect(result.nodeReachable).toBe(false);
    expect(result.walletReachable).toBe(false);
    expect(result.authenticated).toBe(false);
    expect(result.hsdVersion).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
