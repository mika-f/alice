import { describe, expect, it } from "vitest";
import { validateBid } from "./name.js";

describe("validateBid", () => {
  it("has no issues for a valid bid with lockup equal to bid", () => {
    expect(validateBid({ bid: 100n, lockup: 100n })).toEqual([]);
  });

  it("has no issues when lockup exceeds bid for privacy padding", () => {
    expect(validateBid({ bid: 100n, lockup: 200n })).toEqual([]);
  });

  it("flags a non-positive bid", () => {
    const issues = validateBid({ bid: 0n, lockup: 0n });
    expect(issues.map((i) => i.code)).toContain("bid-not-positive");
  });

  it("flags a lockup below the bid", () => {
    const issues = validateBid({ bid: 200n, lockup: 100n });
    expect(issues.map((i) => i.code)).toEqual(["lockup-below-bid"]);
  });
});
