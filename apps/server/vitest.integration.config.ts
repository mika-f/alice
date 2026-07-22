import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // All integration test files share one regtest hsd node/mempool; running them concurrently
    // causes real cross-file races (mempool/height state one file mutates confuses another
    // mid-flight, e.g. a spurious "Name is already opening"). Sequential files avoid that.
    fileParallelism: false,
  },
});
