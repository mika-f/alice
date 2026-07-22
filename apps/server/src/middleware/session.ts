import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/client.js";
import { touchSession } from "../services/session-service.js";
import type { AppEnv } from "../types.js";

export const SESSION_COOKIE = "session";

/** Spec §21.2: HttpOnly, Secure, SameSite=Strict, with an explicit expiry. */
export function setSessionCookie(c: Context, id: string, expiresAt: Date): void {
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Non-blocking: resolves the session (if any) and slides its expiry; public routes still work without one. */
export function attachSession(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = getCookie(c, SESSION_COOKIE);
    const session = id ? touchSession(db, id) : null;
    c.set("session", session);

    if (session) {
      setSessionCookie(c, session.id, session.expiresAt);
    } else if (id) {
      clearSessionCookie(c);
    }

    await next();
  };
}

/** Blocking: 401s when there's no fully authenticated (non-pending-TOTP) session. */
export function requireAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = c.get("session");
    if (!session || session.pendingTotp) {
      return c.json({ error: "Authentication required" }, 401);
    }
    await next();
  };
}

/** Blocking: for the second step of TOTP login, which only a pending session may complete. */
export function requirePendingTotpSession(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = c.get("session");
    if (!session || !session.pendingTotp) {
      return c.json({ error: "No pending login" }, 401);
    }
    await next();
  };
}
