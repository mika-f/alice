import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { confirmBackup, getLastBackupConfirmedAt } from "./backup-service.js";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

describe("backup-service", () => {
  it("reports null before any confirmation", () => {
    expect(getLastBackupConfirmedAt(db)).toBeNull();
  });

  it("records the confirmation timestamp and returns it", () => {
    const before = Date.now();
    const confirmedAt = confirmBackup(db);
    expect(confirmedAt).toBeGreaterThanOrEqual(before);
    expect(getLastBackupConfirmedAt(db)).toBe(confirmedAt);
  });

  it("overwrites a previous confirmation on repeated calls", () => {
    const first = confirmBackup(db);
    const second = confirmBackup(db);
    expect(second).toBeGreaterThanOrEqual(first);
    expect(getLastBackupConfirmedAt(db)).toBe(second);
  });
});
