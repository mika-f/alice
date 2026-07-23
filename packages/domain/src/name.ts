import type { DnsRecord, NameResource } from "./resource.js";

export const NAME_STATES = [
  "opening",
  "bidding",
  "revealing",
  "closed",
  "owned",
  "transferring",
  "revoked",
  "expired",
] as const;

export type NameState = (typeof NAME_STATES)[number];

export const TRANSFER_STATES = ["none", "pending", "finalizable", "finalized", "failed"] as const;

export type TransferState = (typeof TRANSFER_STATES)[number];

export interface OwnedName {
  name: string;
  state: NameState;
  owned: boolean;
  renewalHeight: number;
  expirationHeight: number;
  blocksRemaining: number;
  transferState: TransferState;
  resourceSummary: string | null;
  label?: string;
  memo?: string;
  updatedAt: number;
}

export interface NameBid {
  /** The true bid amount, blinded on-chain until reveal — only known for this wallet's own bids. */
  value: bigint | null;
  lockup: bigint;
  height: number;
  own: boolean;
}

export interface NameReveal {
  value: bigint;
  height: number;
  own: boolean;
}

export interface NameDetails extends OwnedName {
  nameHash: string;
  ownerAddress: string | null;
  blockHeight: number;
  resource: NameResource | null;
  bids: NameBid[];
  reveals: NameReveal[];
}

export interface UpdateNameRequest {
  name: string;
  records: DnsRecord[];
}

/** Result of a dry-run (broadcast:false) update — the real raw bytes/size hsd would commit, without touching the mempool. */
export interface UpdatePreviewResult {
  fee: bigint;
  resource: NameResource;
}

export interface TransferNameRequest {
  name: string;
  address: string;
}

export interface BidNameRequest {
  name: string;
  bid: bigint;
  lockup: bigint;
}

/** hsd's node-side `getnameinfo` result for a name this wallet may never have opened. */
export interface NameAvailability {
  name: string;
  /** True only when the name has never been opened and isn't ICANN-reserved. */
  available: boolean;
  /** ICANN root-zone reserved names can't be opened via a normal auction (spec §27.1). */
  reserved: boolean;
  /** Null when `available` — hsd has no auction record for the name at all. */
  state: NameState | null;
}

export type BidValidationCode = "bid-not-positive" | "lockup-below-bid";

export interface BidValidationIssue {
  code: BidValidationCode;
  message: string;
}

/**
 * hsd requires `lockup >= bid` (the lockup is the publicly-visible output value; the bid is the
 * true, blinded amount hidden until reveal) — this only catches the obvious client-side mistake
 * early, the same "decode via hsd, don't reimplement" stance as resource-validation.ts.
 */
export function validateBid(request: { bid: bigint; lockup: bigint }): BidValidationIssue[] {
  const issues: BidValidationIssue[] = [];
  if (request.bid <= 0n) {
    issues.push({ code: "bid-not-positive", message: "Bid must be greater than zero." });
  }
  if (request.lockup < request.bid) {
    issues.push({ code: "lockup-below-bid", message: "Lockup cannot be lower than the bid." });
  }
  return issues;
}

/** Spec §17.3 batch results: "example1/ Success", "example3/ Failed: Wallet locked", "example4/ Skipped: Renewal not available". */
export type NameActionStatus = "success" | "failed" | "skipped";

export interface NameActionResult {
  name: string;
  status: NameActionStatus;
  txid?: string;
  reason?: string;
}
