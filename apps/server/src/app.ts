import { HsdHttpError } from "@alice-hns-wallet/hsd-client";
import { Hono } from "hono";
import type { Db } from "./db/client.js";
import type { Env } from "./env.js";
import { ensureCsrfCookie, verifyCsrf } from "./middleware/csrf.js";
import { requireHttps } from "./middleware/require-https.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { attachSession } from "./middleware/session.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createBackupRoutes } from "./routes/backup.js";
import { createConnectionRoutes } from "./routes/connection.js";
import { createDiagnosticsRoutes } from "./routes/diagnostics.js";
import { healthRoute } from "./routes/health.js";
import { createNameRoutes } from "./routes/name.js";
import { createNotificationRoutes } from "./routes/notification.js";
import { createReadyRoute } from "./routes/ready.js";
import { createStatusRoutes } from "./routes/status.js";
import { createWalletRoutes } from "./routes/wallet.js";
import type { HsdConnectionManager } from "./services/hsd-connection-manager.js";
import type { RescanTracker } from "./services/rescan-tracker.js";
import type { StatusPoller } from "./services/status-poller.js";
import { mountStaticWeb } from "./static.js";
import type { AppEnv } from "./types.js";

export function createApp(
  env: Env,
  hsdManager: HsdConnectionManager,
  db: Db,
  statusPoller: StatusPoller,
  rescanTracker: RescanTracker,
) {
  const app = new Hono<AppEnv>();

  /**
   * Without this, any unhandled route error (almost always an hsd rejection — wallet locked,
   * auction/renewal timing, insufficient funds) falls through to Hono's default error response,
   * which isn't JSON — so the SPA's error handling can't read a real message out of it and falls
   * back to a generic "Request failed" (see apps/web/src/api/client.ts). This surfaces hsd's own
   * message (already captured with the request context by HsdHttpClient) consistently everywhere.
   */
  app.onError((err, c) => {
    if (err instanceof HsdHttpError) {
      return c.json({ error: err.message }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.use(securityHeaders);
  app.use(requireHttps(env));

  app.route("/", healthRoute);
  app.route("/", createReadyRoute(hsdManager));

  app.use("/api/*", attachSession(db));
  app.use("/api/*", ensureCsrfCookie());
  app.use("/api/*", verifyCsrf(env));
  app.route("/api", createAuthRoutes(db, env));
  app.route("/api", createConnectionRoutes(db, env, hsdManager));
  app.route("/api", createStatusRoutes(statusPoller, db));
  app.route("/api", createBackupRoutes(db, env));
  app.route("/api", createDiagnosticsRoutes(db, env, hsdManager));
  app.route("/api", createWalletRoutes(db, env, hsdManager, rescanTracker));
  app.route("/api", createNameRoutes(db, env, hsdManager, rescanTracker));
  app.route("/api", createNotificationRoutes(db));
  app.route("/api", createAuditRoutes(db));

  mountStaticWeb(app);

  return app;
}
