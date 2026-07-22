import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { loadEnv } from "./env.js";
import { HsdConnectionManager } from "./services/hsd-connection-manager.js";
import { RescanTracker } from "./services/rescan-tracker.js";
import { StatusPoller } from "./services/status-poller.js";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
runMigrations(db);

const hsdManager = HsdConnectionManager.fromEnvOrDb(db, env);
const rescanTracker = new RescanTracker();
const statusPoller = new StatusPoller(hsdManager, db, undefined, rescanTracker, env.ENCRYPTION_KEY);
statusPoller.start();

const app = createApp(env, hsdManager, db, statusPoller, rescanTracker);

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`server listening on http://${env.HOST}:${info.port}`);
});
