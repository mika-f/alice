import type { IncomingMessage } from "node:http";
import type { Context } from "hono";

export function getClientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwardedFor = c.req.header("x-forwarded-for");
    if (forwardedFor) return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}
