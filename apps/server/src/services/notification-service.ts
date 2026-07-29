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
const AUTO_BID_SETTINGS_KEY = "auto_bid_settings";

export interface AutoRevealSettings {
  enabled: boolean;
  /** Only available to the background worker, never returned by the settings API. */
  passphrase: string | null;
}

export interface AutoRevealSettingsStatus {
  enabled: boolean;
  passphraseConfigured: boolean;
}

export type AutoBidTiming = "next-block" | "before-reveal";
export interface AutoBidSettings {
  timing: AutoBidTiming;
  increment: string;
  passphrase: string | null;
  names: Record<string, AutoBidNameSettings>;
  /** A persisted fingerprint prevents retrying for the same visible competing bid after restart. */
  respondedTo: Record<string, string>;
  scheduled: Record<string, { fingerprint: string; targetHeight: number }>;
}
export interface AutoBidNameSettings {
  enabled: boolean;
  budget: string;
  spent: string;
}
export interface AutoBidSettingsStatus {
  timing: AutoBidTiming;
  increment: string;
  passphraseConfigured: boolean;
}
export interface AutoBidNameSettingsStatus extends AutoBidNameSettings {
  remaining: string;
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

export function toAutoRevealSettingsStatus(input: AutoRevealSettings): AutoRevealSettingsStatus {
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
    passphrase: input.enabled ? input.passphrase || existing.passphrase : null,
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

const DEFAULT_AUTO_BID_SETTINGS: AutoBidSettings = {
  timing: "next-block",
  increment: "1000000",
  passphrase: null,
  names: {},
  respondedTo: {},
  scheduled: {},
};

export function getAutoBidSettings(db: Db, encryptionKey: string): AutoBidSettings {
  const [row] = db.select().from(settings).where(eq(settings.key, AUTO_BID_SETTINGS_KEY)).all();
  if (!row) return DEFAULT_AUTO_BID_SETTINGS;
  try {
    const parsed = JSON.parse(decrypt(row.value, encryptionKey)) as Partial<AutoBidSettings>;
    return {
      ...DEFAULT_AUTO_BID_SETTINGS,
      ...parsed,
      passphrase: typeof parsed.passphrase === "string" ? parsed.passphrase : null,
      names: parsed.names ?? {},
      respondedTo: parsed.respondedTo ?? {},
      scheduled: parsed.scheduled ?? {},
    };
  } catch {
    return DEFAULT_AUTO_BID_SETTINGS;
  }
}

function saveAutoBidSettings(db: Db, encryptionKey: string, value: AutoBidSettings): void {
  const encrypted = encrypt(JSON.stringify(value), encryptionKey);
  const [row] = db.select().from(settings).where(eq(settings.key, AUTO_BID_SETTINGS_KEY)).all();
  if (row)
    db.update(settings)
      .set({ value: encrypted })
      .where(eq(settings.key, AUTO_BID_SETTINGS_KEY))
      .run();
  else db.insert(settings).values({ key: AUTO_BID_SETTINGS_KEY, value: encrypted }).run();
}

export function setAutoBidSettings(
  db: Db,
  encryptionKey: string,
  input: Omit<AutoBidSettings, "passphrase" | "respondedTo" | "scheduled" | "names"> & {
    passphrase: string;
  },
): AutoBidSettings {
  const existing = getAutoBidSettings(db, encryptionKey);
  const next: AutoBidSettings = {
    ...input,
    passphrase: input.passphrase || existing.passphrase,
    names: existing.names,
    respondedTo: existing.respondedTo,
    scheduled: existing.scheduled,
  };
  saveAutoBidSettings(db, encryptionKey, next);
  return next;
}

export function getAutoBidNameSettings(
  db: Db,
  encryptionKey: string,
  name: string,
): AutoBidNameSettings {
  return (
    getAutoBidSettings(db, encryptionKey).names[name] ?? { enabled: false, budget: "0", spent: "0" }
  );
}

export function setAutoBidNameSettings(
  db: Db,
  encryptionKey: string,
  name: string,
  input: { enabled: boolean; budget: string },
): AutoBidNameSettings {
  const settings = getAutoBidSettings(db, encryptionKey);
  const next = { enabled: input.enabled, budget: input.budget, spent: "0" };
  settings.names[name] = next;
  if (!next.enabled) {
    delete settings.scheduled[name];
    delete settings.respondedTo[name];
  }
  saveAutoBidSettings(db, encryptionKey, settings);
  return next;
}

/** Stores that a particular public competing bid was handled (or deliberately skipped at budget). */
export function markAutoBidResponse(
  db: Db,
  encryptionKey: string,
  name: string,
  fingerprint: string,
): void {
  const settings = getAutoBidSettings(db, encryptionKey);
  settings.respondedTo[name] = fingerprint;
  delete settings.scheduled[name];
  saveAutoBidSettings(db, encryptionKey, settings);
}

export function recordAutoBidSpend(
  db: Db,
  encryptionKey: string,
  name: string,
  fingerprint: string,
  amount: bigint,
): void {
  const settings = getAutoBidSettings(db, encryptionKey);
  const nameSettings = settings.names[name];
  if (!nameSettings) return;
  nameSettings.spent = (BigInt(nameSettings.spent) + amount).toString();
  settings.respondedTo[name] = fingerprint;
  delete settings.scheduled[name];
  saveAutoBidSettings(db, encryptionKey, settings);
}

export function scheduleAutoBid(
  db: Db,
  encryptionKey: string,
  name: string,
  fingerprint: string,
  targetHeight: number,
): void {
  const settings = getAutoBidSettings(db, encryptionKey);
  settings.scheduled[name] = { fingerprint, targetHeight };
  saveAutoBidSettings(db, encryptionKey, settings);
}

export function toAutoBidSettingsStatus(input: AutoBidSettings): AutoBidSettingsStatus {
  return {
    timing: input.timing,
    increment: input.increment,
    passphraseConfigured: input.passphrase !== null,
  };
}

export function toAutoBidNameSettingsStatus(input: AutoBidNameSettings): AutoBidNameSettingsStatus {
  return { ...input, remaining: (BigInt(input.budget) - BigInt(input.spent)).toString() };
}
