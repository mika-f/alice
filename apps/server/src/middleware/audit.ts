import type { Context, MiddlewareHandler } from "hono";
import type { Db } from "../db/client.js";
import type { Env } from "../env.js";
import { recordAudit } from "../services/audit-service.js";
import type { AppEnv } from "../types.js";
import { getClientIp } from "../util/client-ip.js";

/**
 * Records every attempt at a write operation — success or failure, including ones rejected by
 * auth/reauth/validation further down the chain — so it should be the first middleware on the
 * route. Never logs the request body (only the response status / thrown error message), so a
 * password or mnemonic in the body can never end up in the audit trail (spec §21.6).
 */
export function auditLog(
  db: Db,
  env: Env,
  action: string,
  target?: (c: Context<AppEnv>) => string | null | undefined,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ip = getClientIp(c, env.TRUST_PROXY);
    try {
      await next();
      const status = c.res.status;
      const outcome = status >= 200 && status < 400 ? "success" : "failure";
      recordAudit(db, {
        action,
        target: target?.(c) ?? null,
        outcome,
        detail: outcome === "failure" ? `HTTP ${status}` : null,
        ip,
      });
    } catch (error) {
      recordAudit(db, {
        action,
        target: target?.(c) ?? null,
        outcome: "failure",
        detail: error instanceof Error ? error.message : String(error),
        ip,
      });
      throw error;
    }
  };
}
