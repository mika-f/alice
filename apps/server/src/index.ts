import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { loadEnv } from "./env.js";
import { HsdConnectionManager } from "./services/hsd-connection-manager.js";
import { StatusPoller } from "./services/status-poller.js";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
runMigrations(db);

const hsdManager = HsdConnectionManager.fromEnvOrDb(db, env);
const statusPoller = new StatusPoller(hsdManager);
statusPoller.start();

const app = createApp(env, hsdManager, db, statusPoller);

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`server listening on http://${env.HOST}:${info.port}`);
});
