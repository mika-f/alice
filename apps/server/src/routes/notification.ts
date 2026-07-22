import {
  externalNotificationSettingsRequestSchema,
  renewalThresholdsRequestSchema,
} from "@alice-hns-wallet/schemas";
import { Hono } from "hono";
import type { Db } from "../db/client.js";
import type { Env } from "../env.js";
import { auditLog } from "../middleware/audit.js";
import { requireAuth } from "../middleware/session.js";
import {
  getExternalNotificationSettings,
  sendTestNotification,
  setExternalNotificationSettings,
  toExternalNotificationStatus,
} from "../services/external-notification-service.js";
import {
  getRenewalThresholds,
  listNotifications,
  markNotificationRead,
  setRenewalThresholds,
} from "../services/notification-service.js";
import type { AppEnv } from "../types.js";

export function createNotificationRoutes(db: Db, env: Env) {
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

  app.get("/settings/external-notifications", requireAuth(), (c) => {
    const config = getExternalNotificationSettings(db, env.ENCRYPTION_KEY);
    return c.json(toExternalNotificationStatus(config));
  });

  app.put(
    "/settings/external-notifications",
    auditLog(db, env, "settings.external_notifications"),
    requireAuth(),
    async (c) => {
      const parsed = externalNotificationSettingsRequestSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

      if (parsed.data.ntfy.enabled && !parsed.data.ntfy.url) {
        const existing = getExternalNotificationSettings(db, env.ENCRYPTION_KEY);
        if (!existing.ntfy.url) return c.json({ error: "ntfy URL is required" }, 400);
      }
      if (parsed.data.discord.enabled && !parsed.data.discord.url) {
        const existing = getExternalNotificationSettings(db, env.ENCRYPTION_KEY);
        if (!existing.discord.url) return c.json({ error: "Discord webhook URL is required" }, 400);
      }

      const saved = setExternalNotificationSettings(db, env.ENCRYPTION_KEY, parsed.data);
      return c.json(toExternalNotificationStatus(saved));
    },
  );

  app.post(
    "/settings/external-notifications/test",
    auditLog(db, env, "settings.external_notifications_test"),
    requireAuth(),
    async (c) => {
      const result = await sendTestNotification(db, env.ENCRYPTION_KEY);
      return c.json(result);
    },
  );

  return app;
}
