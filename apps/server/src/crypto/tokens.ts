import { randomBytes, randomInt } from "node:crypto";

export function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Avoids visually ambiguous characters (0/O, 1/I/L). */
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRecoveryCode(): string {
  const group = () =>
    Array.from(
      { length: 4 },
      () => RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)],
    ).join("");
  return `${group()}-${group()}-${group()}`;
}
