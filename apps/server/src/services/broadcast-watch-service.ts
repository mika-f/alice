import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { watchedBroadcasts } from "../db/schema.js";

export interface WatchedBroadcast {
  txid: string;
  label: string | null;
  createdAt: Date;
}

/** Called right after every successful broadcast so the status poller can watch it to confirmation. */
export function watchBroadcast(db: Db, txid: string, label?: string | null): void {
  db.insert(watchedBroadcasts)
    .values({ txid, label: label ?? null })
    .onConflictDoNothing()
    .run();
}

export function listWatchedBroadcasts(db: Db): WatchedBroadcast[] {
  return db.select().from(watchedBroadcasts).all();
}

export function unwatchBroadcast(db: Db, txid: string): void {
  db.delete(watchedBroadcasts).where(eq(watchedBroadcasts.txid, txid)).run();
}
