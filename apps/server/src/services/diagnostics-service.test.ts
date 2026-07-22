import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import type { Env } from "../env.js";
import { confirmBackup } from "./backup-service.js";
import { getDiagnostics } from "./diagnostics-service.js";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

const env: Env = {
  APP_URL: "http://localhost:3000",
  HOST: "0.0.0.0",
  PORT: 3000,
  TRUST_PROXY: false,
  DATABASE_URL: ":memory:",
  HSD_NODE_URL: "http://hsd:12037",
  HSD_NODE_API_KEY: "node-key",
  HSD_WALLET_URL: "http://hsd:12039",
  HSD_WALLET_API_KEY: "wallet-key",
  HSD_WALLET_ID: "primary",
  HSD_NETWORK: "regtest",
  SESSION_SECRET: "x".repeat(32),
  ENCRYPTION_KEY: "y".repeat(32),
};

function fakeManager(overrides: Partial<{ status: boolean; walletStatus: boolean }> = {}) {
  const adapter = {
    getStatus: vi.fn(async () => {
      if (overrides.status === false) throw new Error("node unreachable");
      return {
        connected: true,
        version: "8.0.0",
        network: "regtest",
        chainHeight: 100,
        peerCount: 3,
        synced: true,
        progress: 1,
      };
    }),
    getWalletStatus: vi.fn(async () => {
      if (overrides.walletStatus === false) throw new Error("wallet unreachable");
      return {
        connected: true,
        walletId: "primary",
        network: "regtest",
        walletHeight: 100,
        locked: false,
        rescanning: false,
      };
    }),
  };
  return { get: () => adapter } as never;
}

describe("getDiagnostics", () => {
  it("reports reachable node/wallet, matching networks, and no warnings when backup was confirmed", async () => {
    confirmBackup(db);
    const result = await getDiagnostics(db, env, fakeManager());

    expect(result.node.reachable).toBe(true);
    expect(result.wallet.reachable).toBe(true);
    expect(result.networkMatches).toBe(true);
    expect(result.hsdVersionSupported).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.connection.walletId).toBe("primary");
  });

  it("surfaces the node error and includes it among the warnings", async () => {
    const result = await getDiagnostics(db, env, fakeManager({ status: false }));

    expect(result.node.reachable).toBe(false);
    expect(result.node.error).toContain("node unreachable");
    expect(result.networkMatches).toBeNull();
    expect(result.hsdVersionSupported).toBeNull();
    expect(result.warnings.some((w) => w.type === "node-disconnected")).toBe(true);
  });

  it("surfaces the wallet error separately from the node", async () => {
    const result = await getDiagnostics(db, env, fakeManager({ walletStatus: false }));

    expect(result.node.reachable).toBe(true);
    expect(result.wallet.reachable).toBe(false);
    expect(result.wallet.error).toContain("wallet unreachable");
    expect(result.warnings.some((w) => w.type === "wallet-disconnected")).toBe(true);
  });

  it("includes a backup-stale warning when backup was never confirmed", async () => {
    const result = await getDiagnostics(db, env, fakeManager());
    expect(result.warnings.some((w) => w.type === "backup-stale")).toBe(true);
  });
});
