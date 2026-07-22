import { eq } from "drizzle-orm";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import type { Db } from "../db/client.js";
import { admin, recoveryCodes } from "../db/schema.js";
import { decrypt, encrypt } from "../crypto/encryption.js";
import { hashPassword, verifyPassword } from "../crypto/password.js";
import { generateRecoveryCode } from "../crypto/tokens.js";
import { getAdmin } from "./auth-service.js";

const ISSUER = "Handshake Web Wallet";
const RECOVERY_CODE_COUNT = 8;

export interface TotpEnrollment {
  secret: string;
  qrDataUrl: string;
}

function buildTotp(base32Secret: string, username: string): TOTP {
  return new TOTP({ issuer: ISSUER, label: username, secret: Secret.fromBase32(base32Secret) });
}

/** Stores the pending secret without enabling TOTP; enrollment isn't complete until the code is confirmed. */
export async function beginTotpEnrollment(db: Db, encryptionKey: string): Promise<TotpEnrollment> {
  const record = getAdmin(db);
  if (!record) throw new Error("Admin account does not exist");

  const secret = new Secret({ size: 20 });
  const totp = buildTotp(secret.base32, record.username);

  db.update(admin)
    .set({ totpSecretEnc: encrypt(secret.base32, encryptionKey), totpEnabled: false })
    .where(eq(admin.id, record.id))
    .run();

  const qrDataUrl = await QRCode.toDataURL(totp.toString());
  return { secret: secret.base32, qrDataUrl };
}

export function verifyTotpCode(db: Db, encryptionKey: string, code: string): boolean {
  const record = getAdmin(db);
  if (!record?.totpSecretEnc) return false;

  const secret = decrypt(record.totpSecretEnc, encryptionKey);
  const totp = buildTotp(secret, record.username);
  return totp.validate({ token: code, window: 1 }) !== null;
}

export async function confirmTotpEnrollment(
  db: Db,
  encryptionKey: string,
  code: string,
): Promise<string[]> {
  if (!verifyTotpCode(db, encryptionKey, code)) {
    throw new Error("Invalid TOTP code");
  }

  const record = getAdmin(db);
  if (!record) throw new Error("Admin account does not exist");

  db.update(admin).set({ totpEnabled: true }).where(eq(admin.id, record.id)).run();

  return regenerateRecoveryCodes(db);
}

export function disableTotp(db: Db): void {
  const record = getAdmin(db);
  if (!record) return;

  db.update(admin)
    .set({ totpEnabled: false, totpSecretEnc: null })
    .where(eq(admin.id, record.id))
    .run();
  db.delete(recoveryCodes).run();
}

/** Invalidates any previously issued codes; the caller must display these once and never store them. */
export async function regenerateRecoveryCodes(db: Db): Promise<string[]> {
  db.delete(recoveryCodes).run();

  const plainCodes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = generateRecoveryCode();
    plainCodes.push(code);
    const codeHash = await hashPassword(code);
    db.insert(recoveryCodes).values({ codeHash }).run();
  }

  return plainCodes;
}

/** Single-use: marks the matching code as spent so it can't be replayed. */
export async function verifyAndConsumeRecoveryCode(db: Db, code: string): Promise<boolean> {
  const unused = db
    .select()
    .from(recoveryCodes)
    .all()
    .filter((row) => !row.usedAt);

  for (const row of unused) {
    if (await verifyPassword(row.codeHash, code)) {
      db.update(recoveryCodes)
        .set({ usedAt: new Date() })
        .where(eq(recoveryCodes.id, row.id))
        .run();
      return true;
    }
  }

  return false;
}
