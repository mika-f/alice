import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client.js";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder });
}
