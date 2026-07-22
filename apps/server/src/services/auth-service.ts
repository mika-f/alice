import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { admin, loginAttempts } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../crypto/password.js";

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export interface AdminRecord {
  id: number;
  username: string;
  passwordHash: string;
  totpSecretEnc: string | null;
  totpEnabled: boolean;
}

export function getAdmin(db: Db): AdminRecord | null {
  const [row] = db.select().from(admin).all();
  return row ?? null;
}

export function isSetupComplete(db: Db): boolean {
  return getAdmin(db) !== null;
}

/** Spec §7.1: single admin, set up once on first run; no signup flow. */
export async function setupAdmin(
  db: Db,
  input: { username: string; password: string },
): Promise<AdminRecord> {
  if (isSetupComplete(db)) {
    throw new Error("Setup has already been completed");
  }

  const passwordHash = await hashPassword(input.password);
  db.insert(admin).values({ username: input.username, passwordHash }).run();

  const created = getAdmin(db);
  if (!created) throw new Error("Failed to create admin account");
  return created;
}

export async function verifyCredentials(
  db: Db,
  input: { username: string; password: string },
): Promise<AdminRecord | null> {
  const record = getAdmin(db);
  if (!record || record.username !== input.username) return null;

  const valid = await verifyPassword(record.passwordHash, input.password);
  return valid ? record : null;
}

/** Spec §7.2: locks out an IP after repeated failed login attempts. */
export function isLockedOut(db: Db, ip: string): boolean {
  const [row] = db.select().from(loginAttempts).where(eq(loginAttempts.ip, ip)).all();
  return Boolean(row?.lockedUntil && row.lockedUntil.getTime() > Date.now());
}

export function recordFailedLogin(db: Db, ip: string): void {
  const [row] = db.select().from(loginAttempts).where(eq(loginAttempts.ip, ip)).all();
  const now = new Date();

  if (!row) {
    db.insert(loginAttempts).values({ ip, count: 1, updatedAt: now }).run();
    return;
  }

  const count = row.count + 1;
  const lockedUntil =
    count >= LOGIN_MAX_ATTEMPTS ? new Date(now.getTime() + LOGIN_LOCKOUT_MS) : null;

  db.update(loginAttempts)
    .set({ count, lockedUntil, updatedAt: now })
    .where(eq(loginAttempts.ip, ip))
    .run();
}

export function clearFailedLogins(db: Db, ip: string): void {
  db.delete(loginAttempts).where(eq(loginAttempts.ip, ip)).run();
}
