import { describe, expect, it } from "vitest";
import { generateCsrfToken, generateRecoveryCode, generateSessionId } from "./tokens.js";

describe("generateSessionId / generateCsrfToken", () => {
  it("generates unique, sufficiently long random tokens", () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);

    const csrfA = generateCsrfToken();
    const csrfB = generateCsrfToken();
    expect(csrfA).not.toBe(csrfB);
  });
});

describe("generateRecoveryCode", () => {
  it("generates codes in AAAA-AAAA-AAAA form without ambiguous characters", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("generates distinct codes", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(20);
  });
});
