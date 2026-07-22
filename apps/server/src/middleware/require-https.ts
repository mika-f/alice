import type { IncomingMessage } from "node:http";
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../env.js";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * The `Host` header is client-controlled, so "am I on localhost" can't be decided
 * from the request URL/Host — that would let a remote attacker send `Host: localhost`
 * and bypass HTTPS enforcement entirely. Use the actual TCP peer address instead.
 */
function getRemoteAddress(c: Context): string | undefined {
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress;
}

/** Spec §5.2: HTTP is only permitted from localhost; TRUST_PROXY reads X-Forwarded-Proto. */
export function requireHttps(env: Env): MiddlewareHandler {
  return async (c, next) => {
    if (env.TRUST_PROXY) {
      if (c.req.header("x-forwarded-proto") !== "https") {
        return c.json({ error: "HTTPS is required" }, 403);
      }
      return next();
    }

    const remoteAddress = getRemoteAddress(c);
    const isLoopback = remoteAddress === undefined || LOOPBACK_ADDRESSES.has(remoteAddress);
    const proto = new URL(c.req.url).protocol.replace(":", "");

    if (!isLoopback && proto !== "https") {
      return c.json({ error: "HTTPS is required" }, 403);
    }
    return next();
  };
}
