import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createStatusRoutes } from "./status.js";
import { createDb } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import type { AppEnv } from "../types.js";
import type { StatusSnapshot } from "../services/status-poller.js";

function fakePoller(snapshot: StatusSnapshot) {
  return { getSnapshot: () => snapshot } as never;
}

function buildApp(snapshot: StatusSnapshot, authenticated: boolean) {
  const db = createDb(":memory:");
  runMigrations(db);

  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set(
      "session",
      authenticated
        ? { id: "s1", expiresAt: new Date(Date.now() + 1000), reauthAt: null, pendingTotp: false }
        : null,
    );
    await next();
  });
  app.route("/api", createStatusRoutes(fakePoller(snapshot), db));
  return app;
}

describe("GET /api/status", () => {
  it("requires authentication", async () => {
    const app = buildApp(
      { node: null, nodeError: null, wallet: null, walletError: null, lastUpdated: 0 },
      false,
    );
    const res = await app.request("/api/status");
    expect(res.status).toBe(401);
  });

  it("reports full node/wallet state when available", async () => {
    const app = buildApp(
      {
        node: {
          connected: true,
          version: "8.0.0",
          network: "regtest",
          chainHeight: 42,
          peerCount: 2,
          synced: true,
          progress: 1,
        },
        nodeError: null,
        wallet: {
          connected: true,
          walletId: "primary",
          network: "regtest",
          walletHeight: 42,
          locked: true,
          rescanning: false,
        },
        walletError: null,
        lastUpdated: 123,
      },
      true,
    );
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      node: {
        connected: true,
        version: "8.0.0",
        network: "regtest",
        chainHeight: 42,
        peerCount: 2,
        synced: true,
        progress: 1,
      },
      wallet: {
        connected: true,
        network: "regtest",
        walletHeight: 42,
        locked: true,
        rescanning: false,
      },
      warnings: [
        { type: "wallet-locked", message: "Wallet is locked" },
        { type: "backup-stale", message: "Backup has never been confirmed" },
      ],
      lastUpdated: 123,
    });
  });

  it("degrades gracefully to nulls when the node has never been reached", async () => {
    const app = buildApp(
      {
        node: null,
        nodeError: "unreachable",
        wallet: null,
        walletError: null,
        lastUpdated: 0,
      },
      true,
    );
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      node: {
        connected: false,
        version: null,
        network: null,
        chainHeight: null,
        peerCount: null,
        synced: false,
        progress: 0,
      },
      wallet: {
        connected: false,
        network: null,
        walletHeight: null,
        locked: false,
        rescanning: false,
      },
      warnings: [
        { type: "node-disconnected", message: "Node is unreachable: unreachable" },
        { type: "backup-stale", message: "Backup has never been confirmed" },
      ],
      lastUpdated: 0,
    });
  });
});
