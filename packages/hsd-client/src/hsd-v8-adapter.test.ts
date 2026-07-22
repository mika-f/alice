import { describe, expect, it } from "vitest";
import { isSupportedHsdVersion } from "./hsd-v8-adapter.js";

describe("isSupportedHsdVersion", () => {
  it("accepts 8.x versions", () => {
    expect(isSupportedHsdVersion("8.0.0")).toBe(true);
    expect(isSupportedHsdVersion("8.9.3")).toBe(true);
  });

  it("rejects versions outside the 8.x range", () => {
    expect(isSupportedHsdVersion("7.0.0")).toBe(false);
    expect(isSupportedHsdVersion("9.0.0")).toBe(false);
  });
});
