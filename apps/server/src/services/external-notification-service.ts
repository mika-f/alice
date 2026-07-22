import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "../crypto/encryption.js";
import type { Db } from "../db/client.js";
import { settings } from "../db/schema.js";

const EXTERNAL_NOTIFICATIONS_KEY = "external_notifications";

export interface ExternalNotificationChannel {
  enabled: boolean;
  url: string;
}

export interface ExternalNotificationSettings {
  ntfy: ExternalNotificationChannel;
  discord: ExternalNotificationChannel;
}

export interface ExternalNotificationChannelStatus {
  enabled: boolean;
  configured: boolean;
}

export interface ExternalNotificationStatus {
  ntfy: ExternalNotificationChannelStatus;
  discord: ExternalNotificationChannelStatus;
}

const DEFAULT_SETTINGS: ExternalNotificationSettings = {
  ntfy: { enabled: false, url: "" },
  discord: { enabled: false, url: "" },
};

/** Stored encrypted at rest (spec §4.3) — a channel URL is a bearer capability, same trust tier as an API key. */
export function getExternalNotificationSettings(
  db: Db,
  encryptionKey: string,
): ExternalNotificationSettings {
  const [row] = db
    .select()
    .from(settings)
    .where(eq(settings.key, EXTERNAL_NOTIFICATIONS_KEY))
    .all();
  if (!row) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(
      decrypt(row.value, encryptionKey),
    ) as Partial<ExternalNotificationSettings>;
    return {
      ntfy: { ...DEFAULT_SETTINGS.ntfy, ...parsed.ntfy },
      discord: { ...DEFAULT_SETTINGS.discord, ...parsed.discord },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Never returns the URLs themselves — only whether a channel is on and has something configured. */
export function toExternalNotificationStatus(
  input: ExternalNotificationSettings,
): ExternalNotificationStatus {
  return {
    ntfy: { enabled: input.ntfy.enabled, configured: input.ntfy.url.length > 0 },
    discord: { enabled: input.discord.enabled, configured: input.discord.url.length > 0 },
  };
}

export interface ExternalNotificationChannelInput {
  enabled: boolean;
  /** Empty means "keep the existing configured URL"; only meaningful when already configured. */
  url: string;
}

export interface SetExternalNotificationSettingsInput {
  ntfy: ExternalNotificationChannelInput;
  discord: ExternalNotificationChannelInput;
}

export function setExternalNotificationSettings(
  db: Db,
  encryptionKey: string,
  input: SetExternalNotificationSettingsInput,
): ExternalNotificationSettings {
  const existing = getExternalNotificationSettings(db, encryptionKey);
  const merged: ExternalNotificationSettings = {
    ntfy: { enabled: input.ntfy.enabled, url: input.ntfy.url || existing.ntfy.url },
    discord: { enabled: input.discord.enabled, url: input.discord.url || existing.discord.url },
  };

  const value = encrypt(JSON.stringify(merged), encryptionKey);
  const [row] = db
    .select()
    .from(settings)
    .where(eq(settings.key, EXTERNAL_NOTIFICATIONS_KEY))
    .all();
  if (row) {
    db.update(settings).set({ value }).where(eq(settings.key, EXTERNAL_NOTIFICATIONS_KEY)).run();
  } else {
    db.insert(settings).values({ key: EXTERNAL_NOTIFICATIONS_KEY, value }).run();
  }

  return merged;
}

async function sendNtfy(url: string, message: string): Promise<void> {
  await fetch(url, { method: "POST", body: message });
}

async function sendDiscord(webhookUrl: string, message: string): Promise<void> {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
}

/**
 * Fans the same short message already built for the in-app notification out to every enabled
 * channel. Best-effort: a failed or slow external send must never affect the in-app notification
 * it accompanies, so every channel is fired without awaiting and errors are swallowed (not
 * retried — spec doesn't call for delivery guarantees here). The message itself is whatever the
 * caller already built for the in-app notification, so it can never contain a seed, private key,
 * wallet password, API key, full balance, or raw internal error (spec §20.2) — this function
 * trusts that constraint rather than re-validating it.
 */
export function dispatchExternalNotification(db: Db, encryptionKey: string, message: string): void {
  const config = getExternalNotificationSettings(db, encryptionKey);

  if (config.ntfy.enabled && config.ntfy.url) {
    sendNtfy(config.ntfy.url, message).catch(() => {
      // Best-effort; failures are not surfaced or retried.
    });
  }
  if (config.discord.enabled && config.discord.url) {
    sendDiscord(config.discord.url, message).catch(() => {
      // Best-effort; failures are not surfaced or retried.
    });
  }
}

export async function sendTestNotification(
  db: Db,
  encryptionKey: string,
): Promise<{ ntfy: boolean | null; discord: boolean | null }> {
  const config = getExternalNotificationSettings(db, encryptionKey);
  const message = "Test notification from Handshake Web Wallet.";

  const result: { ntfy: boolean | null; discord: boolean | null } = {
    ntfy: null,
    discord: null,
  };

  if (config.ntfy.enabled && config.ntfy.url) {
    result.ntfy = await sendNtfy(config.ntfy.url, message)
      .then(() => true)
      .catch(() => false);
  }
  if (config.discord.enabled && config.discord.url) {
    result.discord = await sendDiscord(config.discord.url, message)
      .then(() => true)
      .catch(() => false);
  }

  return result;
}
