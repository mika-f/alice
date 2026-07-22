import { Hono } from "hono";
import type { Db } from "./db/client.js";
import type { Env } from "./env.js";
import { ensureCsrfCookie, verifyCsrf } from "./middleware/csrf.js";
import { requireHttps } from "./middleware/require-https.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { attachSession } from "./middleware/session.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createConnectionRoutes } from "./routes/connection.js";
import { healthRoute } from "./routes/health.js";
import { createReadyRoute } from "./routes/ready.js";
import { createStatusRoutes } from "./routes/status.js";
import type { HsdConnectionManager } from "./services/hsd-connection-manager.js";
import type { StatusPoller } from "./services/status-poller.js";
import { mountStaticWeb } from "./static.js";
import type { AppEnv } from "./types.js";

export function createApp(
  env: Env,
  hsdManager: HsdConnectionManager,
  db: Db,
  statusPoller: StatusPoller,
) {
  const app = new Hono<AppEnv>();

  app.use(securityHeaders);
  app.use(requireHttps(env));

  app.route("/", healthRoute);
  app.route("/", createReadyRoute(hsdManager));

  app.use("/api/*", attachSession(db));
  app.use("/api/*", ensureCsrfCookie());
  app.use("/api/*", verifyCsrf());
  app.route("/api", createAuthRoutes(db, env));
  app.route("/api", createConnectionRoutes(db, env, hsdManager));
  app.route("/api", createStatusRoutes(statusPoller));

  mountStaticWeb(app);

  return app;
}
