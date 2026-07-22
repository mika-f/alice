import { describe, expect, it } from "vitest";
import {
  blocksRemaining,
  estimateDaysRemaining,
  estimateSecondsRemaining,
  expirationRatio,
} from "./blocks.js";

describe("blocksRemaining", () => {
  it("returns the difference when target is ahead", () => {
    expect(blocksRemaining(100, 150)).toBe(50);
  });

  it("clamps to zero when already past target", () => {
    expect(blocksRemaining(200, 150)).toBe(0);
  });
});

describe("estimateSecondsRemaining / estimateDaysRemaining", () => {
  it("assumes a 10 minute average block time", () => {
    expect(estimateSecondsRemaining(6)).toBe(3600);
    expect(estimateDaysRemaining(144)).toBeCloseTo(1, 5);
  });

  it("never returns a negative duration", () => {
    expect(estimateSecondsRemaining(-10)).toBe(0);
  });
});

describe("expirationRatio", () => {
  it("returns 0 right after renewal", () => {
    expect(expirationRatio(1000, 1000, 2000)).toBe(0);
  });

  it("returns 1 once expired", () => {
    expect(expirationRatio(2500, 1000, 2000)).toBe(1);
  });

  it("returns a fraction in between", () => {
    expect(expirationRatio(1500, 1000, 2000)).toBeCloseTo(0.5, 5);
  });
});
