import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { requireAuth } from "../middleware/session.js";
import { getLastBackupConfirmedAt } from "../services/backup-service.js";
import { computeDashboardWarnings } from "../services/dashboard-warnings.js";
import type { StatusPoller } from "../services/status-poller.js";
import type { AppEnv } from "../types.js";

export function createStatusRoutes(statusPoller: StatusPoller, db: Db) {
  const app = new Hono<AppEnv>();

  app.get("/status", requireAuth(), (c) => {
    const snapshot = statusPoller.getSnapshot();
    const warnings = computeDashboardWarnings(snapshot, getLastBackupConfirmedAt(db));
    return c.json({
      node: {
        connected: snapshot.node?.connected ?? false,
        version: snapshot.node?.version ?? null,
        network: snapshot.node?.network ?? null,
        chainHeight: snapshot.node?.chainHeight ?? null,
        peerCount: snapshot.node?.peerCount ?? null,
        synced: snapshot.node?.synced ?? false,
        progress: snapshot.node?.progress ?? 0,
      },
      wallet: {
        connected: snapshot.wallet !== null,
        network: snapshot.wallet?.network ?? null,
        walletHeight: snapshot.wallet?.walletHeight ?? null,
        locked: snapshot.wallet?.locked ?? false,
        rescanning: snapshot.wallet?.rescanning ?? false,
      },
      warnings,
      lastUpdated: snapshot.lastUpdated,
    });
  });

  return app;
}
