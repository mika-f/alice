import { describe, expect, it } from "vitest";
import { canAttemptRedeem, NAME_STATES, validateBid } from "./name.js";

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

describe("canAttemptRedeem", () => {
  it.each(["closed", "owned", "transferring", "revoked"] as const)(
    "allows an own reveal to be redeemed while the name is %s",
    (state) => {
      expect(canAttemptRedeem(state, true)).toBe(true);
    },
  );

  it.each(
    NAME_STATES.filter((state) => !["closed", "owned", "transferring", "revoked"].includes(state)),
  )("does not allow redeem while the name is %s", (state) => {
    expect(canAttemptRedeem(state, true)).toBe(false);
  });

  it("requires an own reveal", () => {
    expect(canAttemptRedeem("closed", false)).toBe(false);
  });
});
