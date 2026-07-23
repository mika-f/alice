import {
  classifyRenewal,
  type BidNameRequest,
  type BroadcastResult,
  type NameActionResult,
  type NameAvailability,
  type NameDetails,
  type NameResource,
  type OwnedName,
  type UpdatePreviewResult,
} from "@alice-hns-wallet/domain";
import type { DnsRecord } from "@alice-hns-wallet/domain";
import type { HsdV8Adapter } from "@alice-hns-wallet/hsd-client";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { nameCache, nameMeta } from "../db/schema.js";
import { watchBroadcast } from "./broadcast-watch-service.js";

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

export function previewUpdateName(
  hsd: HsdV8Adapter,
  name: string,
  records: DnsRecord[],
): Promise<UpdatePreviewResult> {
  return hsd.previewUpdateName({ name, records });
}

/** Spec §9.5: minimize how long the wallet stays unlocked; harmless no-op if there's no passphrase. */
export async function updateName(
  db: Db,
  hsd: HsdV8Adapter,
  name: string,
  records: DnsRecord[],
): Promise<BroadcastResult> {
  const result = await hsd.updateName({ name, records });
  watchBroadcast(db, result.txid, name);
  await hsd.lock();
  return result;
}

export function previewRenewName(hsd: HsdV8Adapter, name: string): Promise<BroadcastResult> {
  return hsd.previewRenewName(name);
}

export async function renewName(db: Db, hsd: HsdV8Adapter, name: string): Promise<BroadcastResult> {
  const result = await hsd.renewName(name);
  watchBroadcast(db, result.txid, name);
  await hsd.lock();
  return result;
}

/**
 * Spec §17.3: never all-or-nothing. Names that aren't currently renewable are skipped up front
 * (using one bulk `getNames()` fetch, not a per-name lookup); once the wallet is found locked the
 * rest of the batch is skipped too rather than repeating the same failure ~100 times (spec's own
 * called-out risk: an unlock timeout expiring mid-batch, docs/02 §9).
 */
export async function renewNamesBatch(
  db: Db,
  hsd: HsdV8Adapter,
  names: string[],
): Promise<NameActionResult[]> {
  const currentNames = await listNames(db, hsd);
  const byName = new Map(currentNames.map((item) => [item.name, item]));

  const results: NameActionResult[] = [];
  let walletLocked = false;

  for (const name of names) {
    if (walletLocked) {
      results.push({ name, status: "skipped", reason: "Wallet locked" });
      continue;
    }

    const current = byName.get(name);
    if (!current || classifyRenewal(current) === "not-renewable") {
      results.push({ name, status: "skipped", reason: "Renewal not available" });
      continue;
    }

    const status = await hsd.getWalletStatus();
    if (status.locked) {
      walletLocked = true;
      results.push({ name, status: "failed", reason: "Wallet locked" });
      continue;
    }

    try {
      const result = await hsd.renewName(name);
      watchBroadcast(db, result.txid, name);
      results.push({ name, status: "success", txid: result.txid });
    } catch (error) {
      results.push({
        name,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Locked once at the end (not per-name) — re-locking mid-batch would break every remaining
  // renewal, unlike the single-op writes below where locking immediately after is the point.
  await hsd.lock();
  return results;
}

export function previewTransferName(
  hsd: HsdV8Adapter,
  name: string,
  address: string,
): Promise<BroadcastResult> {
  return hsd.previewTransferName({ name, address });
}

export async function transferName(
  db: Db,
  hsd: HsdV8Adapter,
  name: string,
  address: string,
): Promise<BroadcastResult> {
  const result = await hsd.transferName({ name, address });
  watchBroadcast(db, result.txid, name);
  await hsd.lock();
  return result;
}

export function previewFinalizeName(hsd: HsdV8Adapter, name: string): Promise<BroadcastResult> {
  return hsd.previewFinalizeName(name);
}

export async function finalizeName(
  db: Db,
  hsd: HsdV8Adapter,
  name: string,
): Promise<BroadcastResult> {
  const result = await hsd.finalizeName(name);
  watchBroadcast(db, result.txid, name);
  await hsd.lock();
  return result;
}

export async function revokeName(
  db: Db,
  hsd: HsdV8Adapter,
  name: string,
): Promise<BroadcastResult> {
  const result = await hsd.revokeName(name);
  watchBroadcast(db, result.txid, name);
  await hsd.lock();
  return result;
}

/** Spec §27.1: works for any name, including ones never opened by this or any other wallet. */
export function checkNameAvailability(hsd: HsdV8Adapter, name: string): Promise<NameAvailability> {
  return hsd.getNameAvailability(name);
}

export function previewOpenName(hsd: HsdV8Adapter, name: string): Promise<BroadcastResult> {
  return hsd.previewOpenName(name);
}

export async function openName(db: Db, hsd: HsdV8Adapter, name: string): Promise<BroadcastResult> {
  const result = await hsd.openName(name);
  watchBroadcast(db, result.txid, name);
  await hsd.lock();
  return result;
}

export function previewBidName(
  hsd: HsdV8Adapter,
  request: BidNameRequest,
): Promise<BroadcastResult> {
  return hsd.previewBidName(request);
}

export async function bidName(
  db: Db,
  hsd: HsdV8Adapter,
  request: BidNameRequest,
): Promise<BroadcastResult> {
  const result = await hsd.bidName(request);
  watchBroadcast(db, result.txid, request.name);
  await hsd.lock();
  return result;
}

export function previewRevealName(hsd: HsdV8Adapter, name: string): Promise<BroadcastResult> {
  return hsd.previewRevealName(name);
}

export async function revealName(
  db: Db,
  hsd: HsdV8Adapter,
  name: string,
): Promise<BroadcastResult> {
  const result = await hsd.revealName(name);
  watchBroadcast(db, result.txid, name);
  await hsd.lock();
  return result;
}

export function previewRedeemName(hsd: HsdV8Adapter, name: string): Promise<BroadcastResult> {
  return hsd.previewRedeemName(name);
}

export async function redeemName(
  db: Db,
  hsd: HsdV8Adapter,
  name: string,
): Promise<BroadcastResult> {
  const result = await hsd.redeemName(name);
  watchBroadcast(db, result.txid, name);
  await hsd.lock();
  return result;
}
