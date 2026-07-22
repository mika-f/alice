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

/** Spec §17.3 batch results: "example1/ Success", "example3/ Failed: Wallet locked", "example4/ Skipped: Renewal not available". */
export type NameActionStatus = "success" | "failed" | "skipped";

export interface NameActionResult {
  name: string;
  status: NameActionStatus;
  txid?: string;
  reason?: string;
}
