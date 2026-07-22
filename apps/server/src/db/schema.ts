import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Single row; enforced in application code (spec §7.1: one admin, no signup). */
export const admin = sqliteTable("admin", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const recoveryCodes = sqliteTable("recovery_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codeHash: text("code_hash").notNull(),
  usedAt: integer("used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  reauthAt: integer("reauth_at", { mode: "timestamp" }),
  ip: text("ip"),
  userAgent: text("user_agent"),
  /** True between password success and TOTP confirmation; not a fully authenticated session yet. */
  pendingTotp: integer("pending_totp", { mode: "boolean" }).notNull().default(false),
});

export const loginAttempts = sqliteTable("login_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ip: text("ip").notNull(),
  count: integer("count").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Single row; the app manages exactly one hsd connection (spec §9.1). */
export const connections = sqliteTable("connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  displayName: text("display_name").notNull(),
  nodeUrl: text("node_url").notNull(),
  walletUrl: text("wallet_url").notNull(),
  nodeApiKeyEnc: text("node_api_key_enc").notNull(),
  walletApiKeyEnc: text("wallet_api_key_enc").notNull(),
  walletId: text("wallet_id").notNull(),
  network: text("network").notNull(),
  timeoutMs: integer("timeout_ms").notNull().default(10_000),
  tlsVerify: integer("tls_verify", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Every receive address our app has issued, so §11.1's address history/labels don't depend on hsd exposing that. */
export const addresses = sqliteTable("addresses", {
  address: text("address").primaryKey(),
  addressIndex: integer("address_index").notNull(),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Local-only label/memo for a transaction; never sent to hsd or the chain (spec §12.1). */
export const txMeta = sqliteTable("tx_meta", {
  txid: text("txid").primaryKey(),
  label: text("label"),
  memo: text("memo"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Spec §12.4: replaying the same idempotency key returns the original broadcast instead of sending again. */
export const sendIdempotency = sqliteTable("send_idempotency", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  txid: text("txid").notNull(),
  fee: text("fee").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
