import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";

describe("runMigrations", () => {
  it("creates all expected tables on a fresh database", () => {
    const db = createDb(":memory:");
    runMigrations(db);

    const tables = db
      .all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
      )
      .map((row) => row.name)
      .sort();

    expect(tables).toEqual([
      "admin",
      "connections",
      "login_attempts",
      "recovery_codes",
      "sessions",
      "settings",
    ]);
  });
});
