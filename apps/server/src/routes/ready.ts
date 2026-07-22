import { Hono } from "hono";
import type { HsdConnectionManager } from "../services/hsd-connection-manager.js";
import type { AppEnv } from "../types.js";

/**
 * Spec §22.4: no balances, names, or wallet IDs in an unauthenticated response —
 * booleans only.
 */
export function createReadyRoute(hsdManager: HsdConnectionManager) {
  return new Hono<AppEnv>().get("/ready", async (c) => {
    const hsd = hsdManager.get();
    const checks = {
      node: false,
      wallet: false,
    };

    try {
      await hsd.getStatus();
      checks.node = true;
    } catch {
      checks.node = false;
    }

    try {
      await hsd.getBalance();
      checks.wallet = true;
    } catch {
      checks.wallet = false;
    }

    const ready = checks.node && checks.wallet;
    return c.json({ ready, checks }, ready ? 200 : 503);
  });
}
