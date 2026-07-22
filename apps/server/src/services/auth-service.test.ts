import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import {
  LOGIN_MAX_ATTEMPTS,
  clearFailedLogins,
  isLockedOut,
  isSetupComplete,
  recordFailedLogin,
  setupAdmin,
  verifyCredentials,
} from "./auth-service.js";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

describe("setupAdmin / isSetupComplete", () => {
  it("is not complete before setup", () => {
    expect(isSetupComplete(db)).toBe(false);
  });

  it("creates the single admin account", async () => {
    await setupAdmin(db, { username: "alice", password: "correct-horse-battery-staple" });
    expect(isSetupComplete(db)).toBe(true);
  });

  it("refuses to run setup twice", async () => {
    await setupAdmin(db, { username: "alice", password: "correct-horse-battery-staple" });
    await expect(
      setupAdmin(db, { username: "bob", password: "another-password-here" }),
    ).rejects.toThrow();
  });
});

describe("verifyCredentials", () => {
  it("accepts the correct username and password", async () => {
    await setupAdmin(db, { username: "alice", password: "correct-horse-battery-staple" });
    const result = await verifyCredentials(db, {
      username: "alice",
      password: "correct-horse-battery-staple",
    });
    expect(result?.username).toBe("alice");
  });

  it("rejects a wrong password", async () => {
    await setupAdmin(db, { username: "alice", password: "correct-horse-battery-staple" });
    const result = await verifyCredentials(db, { username: "alice", password: "wrong" });
    expect(result).toBeNull();
  });

  it("rejects an unknown username", async () => {
    await setupAdmin(db, { username: "alice", password: "correct-horse-battery-staple" });
    const result = await verifyCredentials(db, { username: "eve", password: "whatever" });
    expect(result).toBeNull();
  });
});

describe("login lockout", () => {
  const ip = "203.0.113.9";

  it("is not locked out before any failures", () => {
    expect(isLockedOut(db, ip)).toBe(false);
  });

  it("locks out after reaching the max attempt count", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i++) {
      recordFailedLogin(db, ip);
      expect(isLockedOut(db, ip)).toBe(false);
    }
    recordFailedLogin(db, ip);
    expect(isLockedOut(db, ip)).toBe(true);
  });

  it("clearFailedLogins removes the lockout", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) recordFailedLogin(db, ip);
    expect(isLockedOut(db, ip)).toBe(true);
    clearFailedLogins(db, ip);
    expect(isLockedOut(db, ip)).toBe(false);
  });

  it("tracks distinct IPs independently", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) recordFailedLogin(db, ip);
    expect(isLockedOut(db, "203.0.113.10")).toBe(false);
  });
});
