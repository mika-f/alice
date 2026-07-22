import type { NameResource } from "./resource.js";

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

export interface NameDetails extends OwnedName {
  nameHash: string;
  ownerAddress: string | null;
  blockHeight: number;
  resource: NameResource | null;
}

export interface UpdateNameRequest {
  name: string;
  resource: NameResource;
}

export interface TransferNameRequest {
  name: string;
  address: string;
}

export interface NameActionResult {
  name: string;
  success: boolean;
  txid?: string;
  reason?: string;
}
