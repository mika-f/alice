import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { AppEnv } from "./types.js";

const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");

/** Serves the built SPA when it's present (production image); no-op in dev where Vite serves it. */
export function mountStaticWeb(app: Hono<AppEnv>): void {
  if (!existsSync(webDist)) return;

  app.use("/*", serveStatic({ root: webDist }));
  app.get("/*", serveStatic({ path: join(webDist, "index.html") }));
}
