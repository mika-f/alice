import type {
  DnsRecord,
  NameAvailability,
  NameDetails,
  NameResource,
  NameState,
  OwnedName,
  TransferState,
  UpdatePreviewResult,
} from "@alice-hns-wallet/domain";
import type {
  RawAuction,
  RawCovenantPreview,
  RawDnsRecord,
  RawName,
  RawNameInfo,
  RawNameOwner,
  RawNameResource,
} from "./raw-schemas.js";

/** hsd's sentinel for "no owner assigned yet" (pre-auction-close names). */
export const NO_OWNER_INDEX = 0xffffffff;

export function hasOwner(owner: RawNameOwner): boolean {
  return owner.index !== NO_OWNER_INDEX;
}

function blocksRemainingFromStats(stats: Record<string, number> | null): number {
  if (!stats) return 0;
  const key = Object.keys(stats).find((k) => k.startsWith("blocksUntil"));
  if (key === undefined) return 0;
  return Math.max(0, stats[key] as number);
}

/** transferLockup has passed once `blocksUntilValidFinalize` reaches zero or goes negative. */
function isFinalizable(stats: Record<string, number> | null): boolean {
  return stats !== null && (stats.blocksUntilValidFinalize ?? 1) <= 0;
}

export function toNameState(raw: RawName): NameState {
  if (raw.expired) return "expired";
  if (raw.state === "REVOKED") return "revoked";
  if (raw.transfer > 0) return "transferring";

  switch (raw.state) {
    case "OPENING":
      return "opening";
    case "BIDDING":
      return "bidding";
    case "REVEAL":
      return "revealing";
    case "LOCKED":
    case "CLOSED":
      return raw.registered ? "owned" : "closed";
    default:
      return "closed";
  }
}

/** hsd doesn't distinguish "never transferred" from "transfer finalized" — both report transfer=0. */
export function toTransferState(raw: RawName): TransferState {
  if (raw.transfer === 0) return "none";
  return isFinalizable(raw.stats) ? "finalizable" : "pending";
}

function toDnsRecord(raw: RawDnsRecord): DnsRecord {
  switch (raw.type) {
    case "NS":
      return { type: "NS", ns: String(raw.ns) };
    case "GLUE4":
      return { type: "GLUE4", ns: String(raw.ns), address: String(raw.address) };
    case "GLUE6":
      return { type: "GLUE6", ns: String(raw.ns), address: String(raw.address) };
    case "SYNTH4":
      return { type: "SYNTH4", address: String(raw.address) };
    case "SYNTH6":
      return { type: "SYNTH6", address: String(raw.address) };
    case "DS":
      return {
        type: "DS",
        keyTag: Number(raw.keyTag),
        algorithm: Number(raw.algorithm),
        digestType: Number(raw.digestType),
        digest: String(raw.digest),
      };
    case "TXT":
      return { type: "TXT", text: Array.isArray(raw.txt) ? raw.txt.map(String) : [] };
    default:
      return { type: "UNKNOWN", raw: JSON.stringify(raw) };
  }
}

function summarizeRecords(records: DnsRecord[]): string | null {
  if (records.length === 0) return null;
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.type, (counts.get(record.type) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([type, count]) => (count > 1 ? `${type}×${count}` : type))
    .join(", ");
}

/**
 * `dataHex` is the raw wire-format resource hsd committed on-chain (the name's `data` field);
 * `decoded` is the same resource already decoded by hsd's `getnameresource` RPC. Decoding is
 * deliberately left to hsd rather than reimplemented here (see docs/02-IMPLEMENTATION-PLAN.md §9).
 */
export function toNameResource(
  decoded: RawNameResource | null,
  dataHex: string,
): NameResource | null {
  if (!decoded || dataHex.length === 0) return null;
  return {
    records: decoded.records.map(toDnsRecord),
    raw: dataHex,
    size: dataHex.length / 2,
  };
}

/**
 * Bulk listing (spec §14.1) fetches ~100 names in one request and can't afford a per-name
 * ownership lookup, so `owned` is approximated from the global auction outcome recorded by hsd.
 * A wallet that placed a losing bid on a name someone else won will show as owned here until its
 * detail view — which does an authoritative per-name coin lookup, see HsdV8Adapter.getName — is
 * opened. The bulk endpoint also never decodes the resource, so `resourceSummary` is just a byte
 * count rather than a real record summary.
 */
export function toOwnedName(raw: RawName): OwnedName {
  const state = toNameState(raw);
  return {
    name: raw.name,
    state,
    owned: state === "owned" || state === "transferring" || state === "revoked",
    renewalHeight: raw.renewal,
    expirationHeight: raw.stats?.renewalPeriodEnd ?? 0,
    blocksRemaining: blocksRemainingFromStats(raw.stats),
    transferState: toTransferState(raw),
    resourceSummary: raw.data.length > 0 ? `${raw.data.length / 2} bytes` : null,
    updatedAt: Date.now(),
  };
}

/** Reverses toDnsRecord — hsd decodes/encodes DNS records via plain JSON, so no wire-format work happens here. */
function fromDnsRecord(record: DnsRecord): Record<string, unknown> {
  switch (record.type) {
    case "NS":
      return { type: "NS", ns: record.ns };
    case "GLUE4":
      return { type: "GLUE4", ns: record.ns, address: record.address };
    case "GLUE6":
      return { type: "GLUE6", ns: record.ns, address: record.address };
    case "SYNTH4":
      return { type: "SYNTH4", address: record.address };
    case "SYNTH6":
      return { type: "SYNTH6", address: record.address };
    case "DS":
      return {
        type: "DS",
        keyTag: record.keyTag,
        algorithm: record.algorithm,
        digestType: record.digestType,
        digest: record.digest,
      };
    case "TXT":
      return { type: "TXT", txt: record.text };
    case "UNKNOWN":
      // `raw` was produced by JSON.stringify()-ing hsd's own decoded record — round-trips as-is,
      // so records this app can't structurally edit are preserved untouched on update.
      return JSON.parse(record.raw) as Record<string, unknown>;
  }
}

/** Builds the `data` payload hsd's `/wallet/:id/update` expects. */
export function toResourceData(records: DnsRecord[]): { records: Record<string, unknown>[] } {
  return { records: records.map(fromDnsRecord) };
}

/**
 * hsd produces a REGISTER covenant instead of UPDATE the first time a closed-but-unregistered
 * name (a just-won auction, spec §27.6) gets its resource set — same wire call, same resource-hex
 * item position (index 2), just a different covenant action.
 */
function extractUpdateResourceHex(preview: RawCovenantPreview): string {
  const output = preview.outputs.find(
    (o) => o.covenant.action === "UPDATE" || o.covenant.action === "REGISTER",
  );
  if (!output) throw new Error("hsd's UPDATE preview response had no UPDATE/REGISTER output");
  const hex = output.covenant.items[2];
  if (hex === undefined) {
    throw new Error("hsd's UPDATE/REGISTER covenant is missing the resource data item");
  }
  return hex;
}

/** `records` is the caller's own submitted resource — hsd's preview only needs to confirm the raw bytes/fee. */
export function toUpdatePreviewResult(
  preview: RawCovenantPreview,
  records: DnsRecord[],
): UpdatePreviewResult {
  const raw = extractUpdateResourceHex(preview);
  return {
    fee: BigInt(preview.fee),
    resource: { records, raw, size: raw.length / 2 },
  };
}

/** hsd's node-side view of a name, independent of any wallet — used for the pre-Open availability check (spec §27.1). */
export function toNameAvailability(name: string, raw: RawNameInfo): NameAvailability {
  return {
    name,
    available: raw.info === null && !raw.start.reserved,
    reserved: raw.start.reserved,
    state: raw.info ? toNameState(raw.info) : null,
  };
}

export interface OwnershipInfo {
  owned: boolean;
  ownerAddress: string | null;
}

export function toNameDetails(
  raw: RawAuction,
  resource: RawNameResource | null,
  ownership: OwnershipInfo,
): NameDetails {
  const decodedResource = toNameResource(resource, raw.data);
  return {
    name: raw.name,
    nameHash: raw.nameHash,
    state: toNameState(raw),
    owned: ownership.owned,
    ownerAddress: ownership.ownerAddress,
    blockHeight: raw.height,
    renewalHeight: raw.renewal,
    expirationHeight: raw.stats?.renewalPeriodEnd ?? 0,
    blocksRemaining: blocksRemainingFromStats(raw.stats),
    transferState: toTransferState(raw),
    resourceSummary: decodedResource ? summarizeRecords(decodedResource.records) : null,
    resource: decodedResource,
    bids: raw.bids.map((bid) => ({
      value: bid.value !== undefined ? BigInt(bid.value) : null,
      lockup: BigInt(bid.lockup),
      height: bid.height,
      own: bid.own,
    })),
    reveals: raw.reveals.map((reveal) => ({
      value: BigInt(reveal.value),
      height: reveal.height,
      own: reveal.own,
    })),
    updatedAt: Date.now(),
  };
}
