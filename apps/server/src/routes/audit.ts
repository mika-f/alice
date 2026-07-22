import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { requireAuth } from "../middleware/session.js";
import { listAuditLog } from "../services/audit-service.js";
import type { AppEnv } from "../types.js";

export function createAuditRoutes(db: Db) {
  const app = new Hono<AppEnv>();

  app.get("/audit-log", requireAuth(), (c) => {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    return c.json(listAuditLog(db, limit && Number.isInteger(limit) ? limit : undefined));
  });

  return app;
}
