import {
  DEFAULT_RENEWAL_THRESHOLDS,
  DEFAULT_REVEAL_THRESHOLDS,
  type AppNotification,
  type NotificationType,
  type RenewalThresholds,
  type RevealThresholds,
} from "@alice-hns-wallet/domain";
import { desc, eq } from "drizzle-orm";
import { decrypt, encrypt } from "../crypto/encryption.js";
import type { Db } from "../db/client.js";
import { notifications, settings } from "../db/schema.js";
import { dispatchExternalNotification } from "./external-notification-service.js";

const RENEWAL_THRESHOLDS_KEY = "renewal_thresholds";
const REVEAL_THRESHOLDS_KEY = "reveal_thresholds";
const AUTO_REVEAL_SETTINGS_KEY = "auto_reveal_settings";

export interface AutoRevealSettings {
  enabled: boolean;
  /** Only available to the background worker, never returned by the settings API. */
  passphrase: string | null;
}

export interface AutoRevealSettingsStatus {
  enabled: boolean;
  passphraseConfigured: boolean;
}

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

/**
 * `encryptionKey` is optional so callers without it (tests, one-off scripts) can still record an
 * in-app notification without fanning out externally. `input.message` is always the same
 * pre-built, safe string used for the in-app row — never re-derived from raw data — so the §20.2
 * exclusion list (seed/keys/password/full balance/raw errors) holds for external channels too.
 */
export function createNotification(
  db: Db,
  input: CreateNotificationInput,
  encryptionKey?: string,
): void {
  db.insert(notifications)
    .values({ type: input.type, name: input.name ?? null, message: input.message })
    .run();

  if (encryptionKey) {
    dispatchExternalNotification(db, encryptionKey, input.message);
  }
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

/** Stored as JSON under a single settings row — spec §27.7's reveal-deadline threshold. */
export function getRevealThresholds(db: Db): RevealThresholds {
  const [row] = db.select().from(settings).where(eq(settings.key, REVEAL_THRESHOLDS_KEY)).all();
  if (!row) return DEFAULT_REVEAL_THRESHOLDS;

  try {
    const parsed = JSON.parse(row.value) as Partial<RevealThresholds>;
    return { ...DEFAULT_REVEAL_THRESHOLDS, ...parsed };
  } catch {
    return DEFAULT_REVEAL_THRESHOLDS;
  }
}

export function setRevealThresholds(db: Db, thresholds: RevealThresholds): void {
  const value = JSON.stringify(thresholds);
  const [existing] = db
    .select()
    .from(settings)
    .where(eq(settings.key, REVEAL_THRESHOLDS_KEY))
    .all();
  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.key, REVEAL_THRESHOLDS_KEY)).run();
  } else {
    db.insert(settings).values({ key: REVEAL_THRESHOLDS_KEY, value }).run();
  }
}

/** The passphrase is encrypted at rest and is intentionally omitted from the public settings response. */
export function getAutoRevealSettings(db: Db, encryptionKey: string): AutoRevealSettings {
  const [row] = db.select().from(settings).where(eq(settings.key, AUTO_REVEAL_SETTINGS_KEY)).all();
  if (!row) return { enabled: false, passphrase: null };

  try {
    const parsed = JSON.parse(decrypt(row.value, encryptionKey)) as Partial<AutoRevealSettings>;
    return {
      enabled: parsed.enabled === true,
      passphrase: typeof parsed.passphrase === "string" ? parsed.passphrase : null,
    };
  } catch {
    return { enabled: false, passphrase: null };
  }
}

export function toAutoRevealSettingsStatus(
  input: AutoRevealSettings,
): AutoRevealSettingsStatus {
  return { enabled: input.enabled, passphraseConfigured: input.passphrase !== null };
}

export function setAutoRevealSettings(
  db: Db,
  encryptionKey: string,
  input: { enabled: boolean; passphrase: string },
): AutoRevealSettings {
  const existing = getAutoRevealSettings(db, encryptionKey);
  // Disabling deletes the saved passphrase. An empty value while enabled keeps a previously saved
  // passphrase, while still supporting wallets which do not have one.
  const next: AutoRevealSettings = {
    enabled: input.enabled,
    passphrase: input.enabled ? (input.passphrase || existing.passphrase) : null,
  };
  const value = encrypt(JSON.stringify(next), encryptionKey);
  const [row] = db.select().from(settings).where(eq(settings.key, AUTO_REVEAL_SETTINGS_KEY)).all();
  if (row) {
    db.update(settings).set({ value }).where(eq(settings.key, AUTO_REVEAL_SETTINGS_KEY)).run();
  } else {
    db.insert(settings).values({ key: AUTO_REVEAL_SETTINGS_KEY, value }).run();
  }
  return next;
}
