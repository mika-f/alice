import { describe, expect, it } from "vitest";
import { classifyReveal, DEFAULT_REVEAL_THRESHOLDS, type RevealableName } from "./reveal.js";

function name(overrides: Partial<RevealableName>): RevealableName {
  return { state: "revealing", blocksRemaining: 100, ...overrides };
}

describe("classifyReveal", () => {
  it("is none outside the revealing state", () => {
    expect(classifyReveal(name({ state: "bidding" }))).toBe("none");
    expect(classifyReveal(name({ state: "closed" }))).toBe("none");
  });

  it("is pending while revealing with plenty of blocks left", () => {
    expect(classifyReveal(name({ blocksRemaining: 100 }))).toBe("pending");
  });

  it("is urgent once within the configured block threshold", () => {
    expect(
      classifyReveal(name({ blocksRemaining: 10 }), {
        ...DEFAULT_REVEAL_THRESHOLDS,
        blocksRemaining: 36,
      }),
    ).toBe("urgent");
  });

  it("is pending exactly at the threshold boundary", () => {
    expect(
      classifyReveal(name({ blocksRemaining: 36 }), {
        ...DEFAULT_REVEAL_THRESHOLDS,
        blocksRemaining: 36,
      }),
    ).toBe("pending");
  });
});
