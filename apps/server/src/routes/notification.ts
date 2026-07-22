import { renewalThresholdsRequestSchema } from "@alice-hns-wallet/schemas";
import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { requireAuth } from "../middleware/session.js";
import {
  getRenewalThresholds,
  listNotifications,
  markNotificationRead,
  setRenewalThresholds,
} from "../services/notification-service.js";
import type { AppEnv } from "../types.js";

export function createNotificationRoutes(db: Db) {
  const app = new Hono<AppEnv>();

  app.get("/notifications", requireAuth(), (c) => {
    return c.json(listNotifications(db));
  });

  app.post("/notifications/:id/read", requireAuth(), (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid notification id" }, 400);
    markNotificationRead(db, id);
    return c.body(null, 204);
  });

  app.get("/settings/notifications", requireAuth(), (c) => {
    return c.json(getRenewalThresholds(db));
  });

  app.put("/settings/notifications", requireAuth(), async (c) => {
    const parsed = renewalThresholdsRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    setRenewalThresholds(db, parsed.data);
    return c.body(null, 204);
  });

  return app;
}
