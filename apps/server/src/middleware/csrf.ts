import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { generateCsrfToken } from "../crypto/tokens.js";
import type { Env } from "../env.js";

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

/**
 * Spec §21.3: every write operation is checked. Belt-and-suspenders on top of SameSite=Strict.
 *
 * The Origin header is compared against `APP_URL` (the app's configured public origin), not
 * `c.req.url` — behind a reverse proxy like Traefik terminating TLS, the app only ever sees the
 * proxy's internal `http://` request, so comparing against the request's own URL would reject
 * every real browser request (whose Origin is the public `https://` origin) as cross-site.
 */
export function verifyCsrf(env: Env): MiddlewareHandler {
  const expectedOrigin = new URL(env.APP_URL).origin;

  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      return next();
    }

    const secFetchSite = c.req.header("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "same-origin") {
      return c.json({ error: "Cross-site request rejected" }, 403);
    }

    const origin = c.req.header("origin");
    if (origin && origin !== expectedOrigin) {
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
