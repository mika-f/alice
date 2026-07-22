import { Secret, TOTP } from "otpauth";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { setupAdmin } from "./auth-service.js";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  verifyAndConsumeRecoveryCode,
  verifyTotpCode,
} from "./totp-service.js";

const ENCRYPTION_KEY = "x".repeat(32);

let db: Db;

beforeEach(async () => {
  db = createDb(":memory:");
  runMigrations(db);
  await setupAdmin(db, { username: "alice", password: "correct-horse-battery-staple" });
});

function currentCodeFor(secretBase32: string): string {
  const totp = new TOTP({
    issuer: "Handshake Web Wallet",
    label: "alice",
    secret: Secret.fromBase32(secretBase32),
  });
  return totp.generate();
}

describe("beginTotpEnrollment / verifyTotpCode / confirmTotpEnrollment", () => {
  it("issues a secret and QR code without enabling TOTP yet", async () => {
    const enrollment = await beginTotpEnrollment(db, ENCRYPTION_KEY);
    expect(enrollment.secret.length).toBeGreaterThan(0);
    expect(enrollment.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("verifies a correct code against the pending secret", async () => {
    const enrollment = await beginTotpEnrollment(db, ENCRYPTION_KEY);
    const code = currentCodeFor(enrollment.secret);
    expect(verifyTotpCode(db, ENCRYPTION_KEY, code)).toBe(true);
  });

  it("rejects an incorrect code", async () => {
    await beginTotpEnrollment(db, ENCRYPTION_KEY);
    expect(verifyTotpCode(db, ENCRYPTION_KEY, "000000")).toBe(false);
  });

  it("confirming enrollment with a valid code returns recovery codes", async () => {
    const enrollment = await beginTotpEnrollment(db, ENCRYPTION_KEY);
    const code = currentCodeFor(enrollment.secret);
    const recoveryCodes = await confirmTotpEnrollment(db, ENCRYPTION_KEY, code);
    expect(recoveryCodes).toHaveLength(8);
    expect(new Set(recoveryCodes).size).toBe(8);
  });

  it("confirming enrollment with an invalid code throws", async () => {
    await beginTotpEnrollment(db, ENCRYPTION_KEY);
    await expect(confirmTotpEnrollment(db, ENCRYPTION_KEY, "000000")).rejects.toThrow();
  });
});

describe("disableTotp", () => {
  it("clears the secret so codes no longer verify", async () => {
    const enrollment = await beginTotpEnrollment(db, ENCRYPTION_KEY);
    const code = currentCodeFor(enrollment.secret);
    await confirmTotpEnrollment(db, ENCRYPTION_KEY, code);

    disableTotp(db);

    expect(verifyTotpCode(db, ENCRYPTION_KEY, code)).toBe(false);
  });

  it("invalidates existing recovery codes", async () => {
    const enrollment = await beginTotpEnrollment(db, ENCRYPTION_KEY);
    const code = currentCodeFor(enrollment.secret);
    const [recoveryCode] = await confirmTotpEnrollment(db, ENCRYPTION_KEY, code);

    disableTotp(db);

    expect(await verifyAndConsumeRecoveryCode(db, recoveryCode!)).toBe(false);
  });
});

describe("verifyAndConsumeRecoveryCode", () => {
  it("accepts a valid code exactly once", async () => {
    const enrollment = await beginTotpEnrollment(db, ENCRYPTION_KEY);
    const code = currentCodeFor(enrollment.secret);
    const [recoveryCode] = await confirmTotpEnrollment(db, ENCRYPTION_KEY, code);

    expect(await verifyAndConsumeRecoveryCode(db, recoveryCode!)).toBe(true);
    expect(await verifyAndConsumeRecoveryCode(db, recoveryCode!)).toBe(false);
  });

  it("rejects an unknown code", async () => {
    const enrollment = await beginTotpEnrollment(db, ENCRYPTION_KEY);
    const totpCode = currentCodeFor(enrollment.secret);
    await confirmTotpEnrollment(db, ENCRYPTION_KEY, totpCode);

    expect(await verifyAndConsumeRecoveryCode(db, "ZZZZ-ZZZZ-ZZZZ")).toBe(false);
  });
});
