import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { auditLog } from "../middleware/audit.js";
import { requireAuth } from "../middleware/session.js";
import { confirmBackup, getLastBackupConfirmedAt } from "../services/backup-service.js";
import type { Env } from "../env.js";
import type { AppEnv } from "../types.js";

export function createBackupRoutes(db: Db, env: Env) {
  const app = new Hono<AppEnv>();

  app.get("/settings/backup", requireAuth(), (c) => {
    return c.json({ lastConfirmedAt: getLastBackupConfirmedAt(db) });
  });

  app.post("/settings/backup/confirm", auditLog(db, env, "backup.confirm"), requireAuth(), (c) => {
    const lastConfirmedAt = confirmBackup(db);
    return c.json({ lastConfirmedAt });
  });

  return app;
}
