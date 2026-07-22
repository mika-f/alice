import type { MiddlewareHandler } from "hono";
import { getClientIp } from "../util/client-ip.js";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  trustProxy?: boolean;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Spec §21.7: strict limits on login, TOTP, unlock, and every name/HNS write operation.
 * Each call site should create its own instance so windows don't cross-contaminate routes.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();

  return async (c, next) => {
    const now = Date.now();
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }

    const key = getClientIp(c, options.trustProxy ?? false);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (bucket.count >= options.max) {
      c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return c.json({ error: "Too many requests" }, 429);
    }

    bucket.count += 1;
    return next();
  };
}
