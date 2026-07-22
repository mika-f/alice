import {
  DEFAULT_RENEWAL_THRESHOLDS,
  type AppNotification,
  type NotificationType,
  type RenewalThresholds,
} from "@alice-hns-wallet/domain";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { notifications, settings } from "../db/schema.js";

const RENEWAL_THRESHOLDS_KEY = "renewal_thresholds";

export interface CreateNotificationInput {
  type: NotificationType;
  name?: string | null;
  message: string;
}

function toAppNotification(row: typeof notifications.$inferSelect): AppNotification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    name: row.name,
    message: row.message,
    createdAt: row.createdAt.getTime(),
    readAt: row.readAt ? row.readAt.getTime() : null,
  };
}

export function createNotification(db: Db, input: CreateNotificationInput): void {
  db.insert(notifications)
    .values({ type: input.type, name: input.name ?? null, message: input.message })
    .run();
}

export function listNotifications(db: Db, limit = 100): AppNotification[] {
  // `created_at` only has 1-second resolution (unixepoch()), so `id` breaks ties for notifications
  // created in the same second and keeps this reliably newest-first.
  const rows = db.select().from(notifications).orderBy(desc(notifications.id)).limit(limit).all();
  return rows.map(toAppNotification);
}

export function markNotificationRead(db: Db, id: number): void {
  db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id)).run();
}

/** Stored as JSON under a single settings row — spec §17.4's three threshold dimensions. */
export function getRenewalThresholds(db: Db): RenewalThresholds {
  const [row] = db.select().from(settings).where(eq(settings.key, RENEWAL_THRESHOLDS_KEY)).all();
  if (!row) return DEFAULT_RENEWAL_THRESHOLDS;

  try {
    const parsed = JSON.parse(row.value) as Partial<RenewalThresholds>;
    return { ...DEFAULT_RENEWAL_THRESHOLDS, ...parsed };
  } catch {
    return DEFAULT_RENEWAL_THRESHOLDS;
  }
}

export function setRenewalThresholds(db: Db, thresholds: RenewalThresholds): void {
  const value = JSON.stringify(thresholds);
  const [existing] = db
    .select()
    .from(settings)
    .where(eq(settings.key, RENEWAL_THRESHOLDS_KEY))
    .all();
  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.key, RENEWAL_THRESHOLDS_KEY)).run();
  } else {
    db.insert(settings).values({ key: RENEWAL_THRESHOLDS_KEY, value }).run();
  }
}
