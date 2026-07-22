import { describe, expect, it } from "vitest";
import { HsdV8Adapter } from "./hsd-v8-adapter.js";

/**
 * Runs against the regtest hsd started via `docker/compose.dev.yaml`.
 * Skipped automatically when that stack isn't up.
 *
 * `describe.skipIf` evaluates its condition at collection time, before any
 * `beforeAll` hook runs, so the reachability probe has to happen up front via
 * a top-level await instead.
 */
const NODE_URL = process.env.HSD_TEST_NODE_URL ?? "http://127.0.0.1:14037";
const WALLET_URL = process.env.HSD_TEST_WALLET_URL ?? "http://127.0.0.1:14039";
const API_KEY = process.env.HSD_TEST_API_KEY ?? "devkey";

async function probeAvailability(): Promise<boolean> {
  try {
    const res = await fetch(NODE_URL, {
      headers: { Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

const available = await probeAvailability();

describe.skipIf(!available)("HsdV8Adapter against a live regtest hsd", () => {
  const adapter = () =>
    new HsdV8Adapter({
      nodeUrl: NODE_URL,
      nodeApiKey: API_KEY,
      walletUrl: WALLET_URL,
      walletApiKey: API_KEY,
      walletId: "primary",
    });

  it("reads node status", async () => {
    const status = await adapter().getStatus();
    expect(status.network).toBe("regtest");
    expect(status.connected).toBe(true);
  });

  it("reads the node version", async () => {
    const version = await adapter().getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reads wallet balance", async () => {
    const balance = await adapter().getBalance();
    expect(balance.confirmed).toBeTypeOf("bigint");
  });
});
