import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import {
  createSession,
  deleteAllSessions,
  deleteSession,
  isReauthValid,
  markReauth,
  touchSession,
} from "./session-service.js";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

describe("createSession / touchSession", () => {
  it("creates a session that can be looked up", () => {
    const created = createSession(db, { ip: "127.0.0.1" });
    const found = touchSession(db, created.id);
    expect(found?.id).toBe(created.id);
  });

  it("returns null for an unknown session id", () => {
    expect(touchSession(db, "does-not-exist")).toBeNull();
  });

  it("returns null once the session has expired", () => {
    const created = createSession(db, {});
    vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000); // past the 12h idle TTL
    expect(touchSession(db, created.id)).toBeNull();
    vi.useRealTimers();
  });
});

describe("markReauth / isReauthValid", () => {
  it("is invalid until reauth is marked", () => {
    const created = createSession(db, {});
    const session = touchSession(db, created.id);
    expect(session && isReauthValid(session)).toBe(false);
  });

  it("is valid immediately after marking reauth", () => {
    const created = createSession(db, {});
    markReauth(db, created.id);
    const session = touchSession(db, created.id);
    expect(session && isReauthValid(session)).toBe(true);
  });

  it("expires after the reauth TTL", () => {
    const created = createSession(db, {});
    markReauth(db, created.id);
    vi.setSystemTime(Date.now() + 11 * 60 * 1000); // past the 10 minute reauth TTL
    const session = touchSession(db, created.id);
    expect(session && isReauthValid(session)).toBe(false);
    vi.useRealTimers();
  });
});

describe("deleteSession / deleteAllSessions", () => {
  it("deleteSession invalidates only that session", () => {
    const a = createSession(db, {});
    const b = createSession(db, {});
    deleteSession(db, a.id);
    expect(touchSession(db, a.id)).toBeNull();
    expect(touchSession(db, b.id)).not.toBeNull();
  });

  it("deleteAllSessions invalidates every session", () => {
    const a = createSession(db, {});
    const b = createSession(db, {});
    deleteAllSessions(db);
    expect(touchSession(db, a.id)).toBeNull();
    expect(touchSession(db, b.id)).toBeNull();
  });
});
