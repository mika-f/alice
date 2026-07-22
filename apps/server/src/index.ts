import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createHsdClient } from "./hsd.js";

const env = loadEnv();
const hsd = createHsdClient(env);
const app = createApp(env, hsd);

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`server listening on http://${env.HOST}:${info.port}`);
});
