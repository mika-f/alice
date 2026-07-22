import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { generateCsrfToken } from "../crypto/tokens.js";

export const CSRF_COOKIE = "csrf_token";
export const CSRF_HEADER = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Issues a JS-readable (non-HttpOnly) token cookie the SPA echoes back via CSRF_HEADER. */
export function ensureCsrfCookie(): MiddlewareHandler {
  return async (c, next) => {
    if (!getCookie(c, CSRF_COOKIE)) {
      setCookie(c, CSRF_COOKIE, generateCsrfToken(), {
        httpOnly: false,
        secure: true,
        sameSite: "Strict",
        path: "/",
      });
    }
    await next();
  };
}

/** Spec §21.3: every write operation is checked. Belt-and-suspenders on top of SameSite=Strict. */
export function verifyCsrf(): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      return next();
    }

    const secFetchSite = c.req.header("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "same-origin") {
      return c.json({ error: "Cross-site request rejected" }, 403);
    }

    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "Cross-site request rejected" }, 403);
    }

    const cookieToken = getCookie(c, CSRF_COOKIE);
    const headerToken = c.req.header(CSRF_HEADER);
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return c.json({ error: "Invalid CSRF token" }, 403);
    }

    await next();
  };
}
