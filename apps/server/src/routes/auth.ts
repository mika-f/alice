import {
  loginRequestSchema,
  loginTotpRequestSchema,
  reauthRequestSchema,
  setupRequestSchema,
} from "@alice-hns-wallet/schemas";
import { Hono } from "hono";
import type { Db } from "../db/client.js";
import type { Env } from "../env.js";
import { auditLog } from "../middleware/audit.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireReauth } from "../middleware/reauth.js";
import {
  clearSessionCookie,
  requireAuth,
  requirePendingTotpSession,
  setSessionCookie,
} from "../middleware/session.js";
import {
  clearFailedLogins,
  getAdmin,
  isLockedOut,
  isSetupComplete,
  recordFailedLogin,
  setupAdmin,
  verifyCredentials,
} from "../services/auth-service.js";
import {
  confirmTotpSession,
  createSession,
  deleteAllSessions,
  deleteSession,
  markReauth,
} from "../services/session-service.js";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  regenerateRecoveryCodes,
  verifyAndConsumeRecoveryCode,
  verifyTotpCode,
} from "../services/totp-service.js";
import type { AppEnv } from "../types.js";
import { getClientIp } from "../util/client-ip.js";

export function createAuthRoutes(db: Db, env: Env) {
  const app = new Hono<AppEnv>();

  const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, trustProxy: env.TRUST_PROXY });
  const totpLimiter = rateLimit({ windowMs: 60_000, max: 10, trustProxy: env.TRUST_PROXY });

  app.post("/auth/setup", async (c) => {
    if (isSetupComplete(db)) {
      return c.json({ error: "Setup has already been completed" }, 409);
    }

    const parsed = setupRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    await setupAdmin(db, parsed.data);

    const session = createSession(db, {
      ip: getClientIp(c, env.TRUST_PROXY),
      userAgent: c.req.header("user-agent"),
    });
    setSessionCookie(c, session.id, session.expiresAt);
    markReauth(db, session.id);

    return c.json({ username: parsed.data.username });
  });

  app.post("/auth/login", loginLimiter, async (c) => {
    const ip = getClientIp(c, env.TRUST_PROXY);
    if (isLockedOut(db, ip)) {
      return c.json({ error: "Too many failed attempts; try again later" }, 423);
    }

    const parsed = loginRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    const admin = await verifyCredentials(db, parsed.data);
    if (!admin) {
      recordFailedLogin(db, ip);
      return c.json({ error: "Invalid username or password" }, 401);
    }

    clearFailedLogins(db, ip);

    const session = createSession(db, {
      ip,
      userAgent: c.req.header("user-agent"),
      pendingTotp: admin.totpEnabled,
    });
    setSessionCookie(c, session.id, session.expiresAt);
    if (!admin.totpEnabled) {
      markReauth(db, session.id);
    }

    return c.json({ totpRequired: admin.totpEnabled });
  });

  app.post("/auth/login/totp", totpLimiter, requirePendingTotpSession(), async (c) => {
    const parsed = loginTotpRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    const session = c.get("session");
    if (!session) {
      return c.json({ error: "No pending login" }, 401);
    }

    const valid =
      verifyTotpCode(db, env.ENCRYPTION_KEY, parsed.data.code) ||
      (await verifyAndConsumeRecoveryCode(db, parsed.data.code));

    if (!valid) {
      return c.json({ error: "Invalid code" }, 401);
    }

    confirmTotpSession(db, session.id);
    markReauth(db, session.id);
    return c.json({ authenticated: true });
  });

  app.post("/auth/logout", (c) => {
    const session = c.get("session");
    if (session) deleteSession(db, session.id);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.post("/auth/logout-all", auditLog(db, env, "auth.logout_all"), requireAuth(), (c) => {
    deleteAllSessions(db);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.get("/auth/session", (c) => {
    const session = c.get("session");
    const setupComplete = isSetupComplete(db);

    if (!session || session.pendingTotp) {
      return c.json({
        authenticated: false,
        setupComplete,
        pendingTotp: session?.pendingTotp ?? false,
      });
    }

    const record = getAdmin(db);
    return c.json({
      authenticated: true,
      setupComplete,
      pendingTotp: false,
      username: record?.username,
      totpEnabled: record?.totpEnabled ?? false,
    });
  });

  /** Spec §7.4: re-establishes a short reauth window for sensitive operations. */
  app.post("/auth/reauth", requireAuth(), totpLimiter, async (c) => {
    const parsed = reauthRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    const record = getAdmin(db);
    if (!record) {
      return c.json({ error: "Admin account does not exist" }, 500);
    }

    const valid =
      parsed.data.method === "password"
        ? (await verifyCredentials(db, {
            username: record.username,
            password: parsed.data.password,
          })) !== null
        : verifyTotpCode(db, env.ENCRYPTION_KEY, parsed.data.code) ||
          (await verifyAndConsumeRecoveryCode(db, parsed.data.code));

    if (!valid) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const session = c.get("session");
    if (session) markReauth(db, session.id);

    return c.json({ reauthenticated: true });
  });

  app.post("/auth/totp/enroll", requireAuth(), async (c) => {
    const enrollment = await beginTotpEnrollment(db, env.ENCRYPTION_KEY);
    return c.json(enrollment);
  });

  app.post("/auth/totp/verify", requireAuth(), totpLimiter, async (c) => {
    const parsed = loginTotpRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    try {
      const recoveryCodesList = await confirmTotpEnrollment(
        db,
        env.ENCRYPTION_KEY,
        parsed.data.code,
      );
      return c.json({ recoveryCodes: recoveryCodesList });
    } catch {
      return c.json({ error: "Invalid code" }, 401);
    }
  });

  app.post("/auth/totp/disable", auditLog(db, env, "auth.totp_disable"), requireReauth(), (c) => {
    disableTotp(db);
    return c.body(null, 204);
  });

  app.post(
    "/auth/recovery/regen",
    auditLog(db, env, "auth.recovery_regen"),
    requireReauth(),
    async (c) => {
      const recoveryCodesList = await regenerateRecoveryCodes(db);
      return c.json({ recoveryCodes: recoveryCodesList });
    },
  );

  return app;
}
