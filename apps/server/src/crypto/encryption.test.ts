import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./encryption.js";

describe("encrypt/decrypt", () => {
  const secret = "x".repeat(32);

  it("round-trips a plaintext value", () => {
    const ciphertext = encrypt("super-secret-api-key", secret);
    expect(decrypt(ciphertext, secret)).toBe("super-secret-api-key");
  });

  it("produces different ciphertext for the same input (random IV)", () => {
    const a = encrypt("same-input", secret);
    const b = encrypt("same-input", secret);
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with the wrong secret", () => {
    const ciphertext = encrypt("super-secret-api-key", secret);
    expect(() => decrypt(ciphertext, "y".repeat(32))).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decrypt("not-a-valid-payload", secret)).toThrow();
  });
});
