import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sessions } from "../db/schema.js";
import { generateSessionId } from "../crypto/tokens.js";

/** Sliding idle timeout; refreshed on every authenticated request. */
export const SESSION_IDLE_TTL_MS = 12 * 60 * 60 * 1000;

/** How long a reauth (password/TOTP) stays valid for sensitive operations (spec §7.4). */
export const REAUTH_TTL_MS = 10 * 60 * 1000;

export interface SessionRecord {
  id: string;
  expiresAt: Date;
  reauthAt: Date | null;
  /** True between password success and TOTP confirmation; not a fully authenticated session yet. */
  pendingTotp: boolean;
}

export interface CreateSessionInput {
  ip?: string;
  userAgent?: string;
  pendingTotp?: boolean;
}

export function createSession(db: Db, input: CreateSessionInput): SessionRecord {
  const id = generateSessionId();
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_IDLE_TTL_MS);
  const pendingTotp = input.pendingTotp ?? false;

  db.insert(sessions)
    .values({
      id,
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
      pendingTotp,
    })
    .run();

  return { id, expiresAt, reauthAt: null, pendingTotp };
}

/** Returns the session and slides its expiry, or null if missing/expired. */
export function touchSession(db: Db, id: string): SessionRecord | null {
  const now = new Date();
  const [session] = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .all();

  if (!session) return null;

  const expiresAt = new Date(now.getTime() + SESSION_IDLE_TTL_MS);
  db.update(sessions).set({ expiresAt, lastSeenAt: now }).where(eq(sessions.id, id)).run();

  return {
    id: session.id,
    expiresAt,
    reauthAt: session.reauthAt,
    pendingTotp: session.pendingTotp,
  };
}

/** Finalizes a pending-TOTP session once the code has been verified. */
export function confirmTotpSession(db: Db, id: string): void {
  db.update(sessions).set({ pendingTotp: false }).where(eq(sessions.id, id)).run();
}

export function markReauth(db: Db, id: string): void {
  db.update(sessions).set({ reauthAt: new Date() }).where(eq(sessions.id, id)).run();
}

export function isReauthValid(session: SessionRecord): boolean {
  if (!session.reauthAt) return false;
  return Date.now() - session.reauthAt.getTime() < REAUTH_TTL_MS;
}

export function deleteSession(db: Db, id: string): void {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

export function deleteAllSessions(db: Db): void {
  db.delete(sessions).run();
}
