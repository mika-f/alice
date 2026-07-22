import type { CovenantType } from "./covenant.js";

export const TRANSACTION_STATUSES = [
  "pending",
  "confirmed",
  "replaced",
  "conflicted",
  "failed",
  "unknown",
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_KINDS = ["send", "receive", "name-operation"] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export interface TransactionInput {
  txid: string;
  index: number;
  address?: string;
  value?: bigint;
}

export interface TransactionOutput {
  address?: string;
  value: bigint;
  covenant: CovenantType;
  name?: string;
}

export interface TransactionRecord {
  txid: string;
  kind: TransactionKind;
  amount: bigint;
  fee: bigint;
  timestamp: number | null;
  blockHeight: number | null;
  confirmations: number;
  status: TransactionStatus;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  label?: string;
  memo?: string;
}

export interface TransactionPage {
  items: TransactionRecord[];
  nextCursor: string | null;
}

export interface TransactionQuery {
  cursor?: string;
  limit?: number;
}
