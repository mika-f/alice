import { describe, expect, it } from "vitest";
import {
  classifyRenewal,
  DEFAULT_RENEWAL_THRESHOLDS,
  isRenewable,
  type RenewableName,
} from "./renewal.js";

function name(overrides: Partial<RenewableName>): RenewableName {
  return {
    state: "owned",
    transferState: "none",
    blocksRemaining: 100_000,
    renewalHeight: 0,
    expirationHeight: 200_000,
    ...overrides,
  };
}

describe("classifyRenewal", () => {
  it("is not-renewable when the name isn't owned", () => {
    expect(classifyRenewal(name({ state: "bidding" }))).toBe("not-renewable");
  });

  it("is not-renewable while a transfer is pending", () => {
    expect(classifyRenewal(name({ transferState: "pending" }))).toBe("not-renewable");
  });

  it("is not-needed when far from expiration", () => {
    expect(classifyRenewal(name({ blocksRemaining: 100_000, expirationHeight: 200_000 }))).toBe(
      "not-needed",
    );
  });

  it("is recommended once within the configured threshold", () => {
    expect(
      classifyRenewal(name({ blocksRemaining: 4000, expirationHeight: 100_000 }), {
        ...DEFAULT_RENEWAL_THRESHOLDS,
        blocksRemaining: 4320,
      }),
    ).toBe("recommended");
  });

  it("is imminent once within a fifth of the configured threshold", () => {
    expect(
      classifyRenewal(name({ blocksRemaining: 500 }), {
        ...DEFAULT_RENEWAL_THRESHOLDS,
        blocksRemaining: 4320,
      }),
    ).toBe("imminent");
  });

  it("treats a low expiration ratio as recommended even with plenty of absolute blocks left", () => {
    const category = classifyRenewal(
      name({ renewalHeight: 0, expirationHeight: 1_000_000, blocksRemaining: 50_000 }),
      { blocksRemaining: 1, daysRemaining: 1, expirationRatio: 0.1 },
    );
    expect(category).toBe("recommended");
  });
});

describe("isRenewable", () => {
  it("is true for any renewable category", () => {
    expect(isRenewable(name({ blocksRemaining: 100_000 }))).toBe(true);
  });

  it("is false when not-renewable", () => {
    expect(isRenewable(name({ state: "revoked" }))).toBe(false);
  });
});
