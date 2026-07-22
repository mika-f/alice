import type { MiddlewareHandler } from "hono";
import { isReauthValid } from "../services/session-service.js";
import type { AppEnv } from "../types.js";

/** Spec §7.4: send/update/renew/transfer/finalize/revoke/import/reconfigure all require a recent reauth. */
export function requireReauth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = c.get("session");
    if (!session || session.pendingTotp) {
      return c.json({ error: "Authentication required" }, 401);
    }
    if (!isReauthValid(session)) {
      return c.json({ error: "Reauthentication required" }, 403);
    }
    await next();
  };
}
