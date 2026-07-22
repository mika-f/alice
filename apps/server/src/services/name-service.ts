import type { NameDetails, NameResource, OwnedName } from "@alice-hns-wallet/domain";
import type { HsdV8Adapter } from "@alice-hns-wallet/hsd-client";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { nameCache, nameMeta } from "../db/schema.js";

export interface NameMetaInput {
  label?: string;
  memo?: string;
}

function withMeta<T extends { name: string; label?: string; memo?: string }>(
  item: T,
  meta: { label: string | null; memo: string | null } | undefined,
): T {
  if (!meta) return item;
  return { ...item, label: meta.label ?? undefined, memo: meta.memo ?? undefined };
}

/** Refreshes the display cache (spec §14.1); best-effort and never blocks the response on failure. */
function refreshNameCache(db: Db, names: OwnedName[]): void {
  for (const item of names) {
    const row = {
      state: item.state,
      owned: item.owned,
      renewalHeight: item.renewalHeight,
      expirationHeight: item.expirationHeight,
      blocksRemaining: item.blocksRemaining,
      transferState: item.transferState,
      resourceSummary: item.resourceSummary,
      updatedAt: new Date(),
    };
    db.insert(nameCache)
      .values({ name: item.name, ...row })
      .onConflictDoUpdate({ target: nameCache.name, set: row })
      .run();
  }
}

/** Spec §14.1: the whole ~100-name list comes from a single hsd request; filtering/sorting is client-side. */
export async function listNames(db: Db, hsd: HsdV8Adapter): Promise<OwnedName[]> {
  const names = await hsd.getNames();
  refreshNameCache(db, names);

  const metaRows = db.select().from(nameMeta).all();
  const metaByName = new Map(metaRows.map((row) => [row.name, row]));

  return names.map((item) => withMeta(item, metaByName.get(item.name)));
}

export async function getNameDetail(db: Db, hsd: HsdV8Adapter, name: string): Promise<NameDetails> {
  const detail = await hsd.getName(name);
  const [meta] = db.select().from(nameMeta).where(eq(nameMeta.name, name)).all();
  return withMeta(detail, meta);
}

export async function getNameResource(
  hsd: HsdV8Adapter,
  name: string,
): Promise<NameResource | null> {
  const detail = await hsd.getName(name);
  return detail.resource;
}

export function setNameMeta(db: Db, name: string, input: NameMetaInput): void {
  const [existing] = db.select().from(nameMeta).where(eq(nameMeta.name, name)).all();
  if (existing) {
    db.update(nameMeta)
      .set({ label: input.label, memo: input.memo, updatedAt: new Date() })
      .where(eq(nameMeta.name, name))
      .run();
  } else {
    db.insert(nameMeta).values({ name, label: input.label, memo: input.memo }).run();
  }
}
