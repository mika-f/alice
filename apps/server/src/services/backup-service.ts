import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { settings } from "../db/schema.js";

const BACKUP_CONFIRMED_AT_KEY = "last_backup_confirmed_at";

/** Spec §10.3: "backup is stale" is purely a self-reported timestamp — the app has no way to verify an actual backup exists. */
export function getLastBackupConfirmedAt(db: Db): number | null {
  const [row] = db.select().from(settings).where(eq(settings.key, BACKUP_CONFIRMED_AT_KEY)).all();
  if (!row) return null;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function confirmBackup(db: Db): number {
  const now = Date.now();
  const value = String(now);
  const [existing] = db
    .select()
    .from(settings)
    .where(eq(settings.key, BACKUP_CONFIRMED_AT_KEY))
    .all();
  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.key, BACKUP_CONFIRMED_AT_KEY)).run();
  } else {
    db.insert(settings).values({ key: BACKUP_CONFIRMED_AT_KEY, value }).run();
  }
  return now;
}
