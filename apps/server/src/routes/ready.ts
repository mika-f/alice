import type { HsdV8Adapter } from "@alice-hns-wallet/hsd-client";
import { Hono } from "hono";

/**
 * Spec §22.4: no balances, names, or wallet IDs in an unauthenticated response —
 * booleans only.
 */
export function createReadyRoute(hsd: HsdV8Adapter) {
  return new Hono().get("/ready", async (c) => {
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
