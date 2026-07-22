import { connectionConfigSchema } from "@alice-hns-wallet/schemas";
import { Hono } from "hono";
import type { Db } from "../db/client.js";
import type { Env } from "../env.js";
import { requireReauth } from "../middleware/reauth.js";
import { requireAuth } from "../middleware/session.js";
import {
  getActiveConnection,
  saveConnection,
  testConnection,
  toSafeConnection,
} from "../services/connection-service.js";
import type { HsdConnectionManager } from "../services/hsd-connection-manager.js";
import type { AppEnv } from "../types.js";

export function createConnectionRoutes(db: Db, env: Env, hsdManager: HsdConnectionManager) {
  const app = new Hono<AppEnv>();

  app.get("/connection", requireAuth(), (c) => {
    const connection = getActiveConnection(db, env, env.ENCRYPTION_KEY);
    return c.json(toSafeConnection(connection));
  });

  app.post("/connection/test", requireReauth(), async (c) => {
    const parsed = connectionConfigSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    const result = await testConnection(parsed.data);
    return c.json(result);
  });

  /** Spec §8.3: every check must pass before the new connection is saved and applied. */
  app.put("/connection", requireReauth(), async (c) => {
    const parsed = connectionConfigSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    const result = await testConnection(parsed.data);
    if (!result.authenticated || !result.networkMatches || !result.walletUsable) {
      return c.json({ error: "Connection test failed", result }, 422);
    }

    saveConnection(db, env.ENCRYPTION_KEY, parsed.data);
    hsdManager.reconfigure(getActiveConnection(db, env, env.ENCRYPTION_KEY));

    return c.json(toSafeConnection(getActiveConnection(db, env, env.ENCRYPTION_KEY)));
  });

  return app;
}
