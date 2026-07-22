import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = {
  HSD_NODE_URL: "http://hsd:12037",
  HSD_NODE_API_KEY: "node-key",
  HSD_WALLET_URL: "http://hsd:12039",
  HSD_WALLET_API_KEY: "wallet-key",
  HSD_WALLET_ID: "primary",
  SESSION_SECRET: "x".repeat(32),
  ENCRYPTION_KEY: "y".repeat(32),
};

describe("loadEnv TRUST_PROXY parsing", () => {
  it("defaults to false when unset", () => {
    expect(loadEnv(base).TRUST_PROXY).toBe(false);
  });

  it("parses the string 'false' as false (not JS Boolean() coercion)", () => {
    expect(loadEnv({ ...base, TRUST_PROXY: "false" }).TRUST_PROXY).toBe(false);
  });

  it("parses the string 'true' as true", () => {
    expect(loadEnv({ ...base, TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
  });

  it("parses '0' and '1' as booleans", () => {
    expect(loadEnv({ ...base, TRUST_PROXY: "0" }).TRUST_PROXY).toBe(false);
    expect(loadEnv({ ...base, TRUST_PROXY: "1" }).TRUST_PROXY).toBe(true);
  });

  it("rejects an invalid value", () => {
    expect(() => loadEnv({ ...base, TRUST_PROXY: "yes" })).toThrow();
  });
});
