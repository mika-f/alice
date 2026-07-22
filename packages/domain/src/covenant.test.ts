import { describe, expect, it } from "vitest";
import { COVENANT_TYPES, describeCovenant } from "./covenant.js";

describe("describeCovenant", () => {
  it("has a human readable label for every covenant type", () => {
    for (const type of COVENANT_TYPES) {
      expect(describeCovenant(type).length).toBeGreaterThan(0);
    }
  });
});
