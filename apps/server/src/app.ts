import type { HsdV8Adapter } from "@alice-hns-wallet/hsd-client";
import { Hono } from "hono";
import type { Env } from "./env.js";
import { requireHttps } from "./middleware/require-https.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { healthRoute } from "./routes/health.js";
import { createReadyRoute } from "./routes/ready.js";
import { mountStaticWeb } from "./static.js";

export function createApp(env: Env, hsd: HsdV8Adapter) {
  const app = new Hono();

  app.use(securityHeaders);
  app.use(requireHttps(env));

  app.route("/", healthRoute);
  app.route("/", createReadyRoute(hsd));

  mountStaticWeb(app);

  return app;
}
