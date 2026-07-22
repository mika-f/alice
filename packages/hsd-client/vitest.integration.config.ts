import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration test files share one regtest hsd node/mempool; running them concurrently
    // causes real cross-file races. Sequential files avoid that (see apps/server's same config).
    fileParallelism: false,
  },
});
