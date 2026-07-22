import { describe, expect, it } from "vitest";
import { formatHns, parseHnsToSmallestUnit } from "./hns.js";

describe("formatHns", () => {
  it("formats a whole number of HNS", () => {
    expect(formatHns("2000000000")).toBe("2000");
  });

  it("formats a fractional amount, trimming trailing zeros", () => {
    expect(formatHns("1500000")).toBe("1.5");
  });

  it("formats zero", () => {
    expect(formatHns("0")).toBe("0");
  });

  it("formats a negative amount", () => {
    expect(formatHns("-500000")).toBe("-0.5");
  });

  it("accepts a bigint directly", () => {
    expect(formatHns(100_000_000n)).toBe("100");
  });
});

describe("parseHnsToSmallestUnit", () => {
  it("parses a whole number", () => {
    expect(parseHnsToSmallestUnit("100")).toBe("100000000");
  });

  it("parses a fractional amount", () => {
    expect(parseHnsToSmallestUnit("1.5")).toBe("1500000");
  });

  it("truncates extra decimal precision beyond 6 places", () => {
    expect(parseHnsToSmallestUnit("1.1234567")).toBe("1123456");
  });

  it("round-trips through formatHns", () => {
    const smallest = parseHnsToSmallestUnit("42.000123");
    expect(formatHns(smallest)).toBe("42.000123");
  });
});
