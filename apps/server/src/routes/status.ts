import { Hono } from "hono";
import { requireAuth } from "../middleware/session.js";
import type { StatusPoller } from "../services/status-poller.js";
import type { AppEnv } from "../types.js";

export function createStatusRoutes(statusPoller: StatusPoller) {
  const app = new Hono<AppEnv>();

  app.get("/status", requireAuth(), (c) => {
    const snapshot = statusPoller.getSnapshot();
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
        walletHeight: snapshot.wallet?.walletHeight ?? null,
        locked: snapshot.wallet?.locked ?? false,
        rescanning: snapshot.wallet?.rescanning ?? false,
      },
      lastUpdated: snapshot.lastUpdated,
    });
  });

  return app;
}
