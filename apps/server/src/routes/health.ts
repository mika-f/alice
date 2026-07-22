import { Hono } from "hono";
import type { AppEnv } from "../types.js";

export const healthRoute = new Hono<AppEnv>().get("/health", (c) => c.json({ status: "ok" }));
