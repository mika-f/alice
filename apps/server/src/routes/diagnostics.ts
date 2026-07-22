import { Hono } from "hono";
import type { Db } from "../db/client.js";
import type { Env } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { getDiagnostics } from "../services/diagnostics-service.js";
import type { HsdConnectionManager } from "../services/hsd-connection-manager.js";
import type { AppEnv } from "../types.js";

export function createDiagnosticsRoutes(db: Db, env: Env, hsdManager: HsdConnectionManager) {
  const app = new Hono<AppEnv>();

  app.get("/diagnostics", requireAuth(), async (c) => {
    const result = await getDiagnostics(db, env, hsdManager);
    return c.json(result);
  });

  return app;
}
