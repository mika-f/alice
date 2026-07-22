import { describe, expect, it } from "vitest";
import { connectionConfigSchema } from "./connection.js";

describe("connectionConfigSchema", () => {
  it("accepts a valid config and applies defaults", () => {
    const result = connectionConfigSchema.parse({
      displayName: "Home server",
      nodeUrl: "http://hsd-host:12037",
      walletUrl: "http://hsd-host:12039",
      nodeApiKey: "node-key",
      walletApiKey: "wallet-key",
      walletId: "primary",
      network: "main",
    });

    expect(result.timeoutMs).toBe(10_000);
    expect(result.tlsVerify).toBe(true);
  });

  it("rejects an invalid network", () => {
    expect(() =>
      connectionConfigSchema.parse({
        displayName: "Home server",
        nodeUrl: "http://hsd-host:12037",
        walletUrl: "http://hsd-host:12039",
        nodeApiKey: "node-key",
        walletApiKey: "wallet-key",
        walletId: "primary",
        network: "mainnet",
      }),
    ).toThrow();
  });
});
