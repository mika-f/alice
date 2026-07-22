import { apiFetch } from "./client.js";

export interface WalletBalanceResponse {
  confirmed: string;
  unconfirmed: string;
  locked: string;
  spendable: string;
}

export interface WalletStatusResponse {
  connected: boolean;
  walletId: string;
  network: string;
  walletHeight: number;
  locked: boolean;
  rescanning: boolean;
}

export interface ReceiveAddressResponse {
  address: string;
  index: number;
  used: boolean;
}

export interface AddressHistoryEntry {
  address: string;
  index: number;
  label: string | null;
  used: boolean;
  createdAt: string;
}

export interface BroadcastResultResponse {
  txid: string;
  fee: string;
}

export interface TransactionResponse {
  txid: string;
  kind: "send" | "receive" | "name-operation";
  amount: string;
  fee: string;
  timestamp: number | null;
  blockHeight: number | null;
  confirmations: number;
  status: string;
  label?: string;
  memo?: string;
  inputs: { address?: string; value?: string }[];
  outputs: { address?: string; value: string; covenant: string }[];
}

export interface TransactionPageResponse {
  items: TransactionResponse[];
  nextCursor: string | null;
}

export function getBalance(): Promise<WalletBalanceResponse> {
  return apiFetch("/api/wallet/balance");
}

export function getWalletStatus(): Promise<WalletStatusResponse> {
  return apiFetch("/api/wallet/status");
}

export function issueReceiveAddress(): Promise<ReceiveAddressResponse> {
  return apiFetch("/api/wallet/receive-address", { method: "POST" });
}

export function listAddresses(): Promise<AddressHistoryEntry[]> {
  return apiFetch("/api/wallet/addresses");
}

export function setAddressLabel(address: string, label: string | null): Promise<void> {
  return apiFetch(`/api/wallet/addresses/${encodeURIComponent(address)}/meta`, {
    method: "PUT",
    body: JSON.stringify({ label }),
  });
}

export interface SendInput {
  address: string;
  amount: string;
  feeRate?: number;
  label?: string;
  memo?: string;
  idempotencyKey: string;
}

export function estimateSend(input: SendInput): Promise<BroadcastResultResponse> {
  return apiFetch("/api/wallet/send/estimate", { method: "POST", body: JSON.stringify(input) });
}

export function sendHns(input: SendInput): Promise<BroadcastResultResponse> {
  return apiFetch("/api/wallet/send", { method: "POST", body: JSON.stringify(input) });
}

export function getTransactions(params: {
  cursor?: string;
  limit?: number;
}): Promise<TransactionPageResponse> {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch(`/api/wallet/transactions${suffix}`);
}

export function setTxMeta(txid: string, input: { label?: string; memo?: string }): Promise<void> {
  return apiFetch(`/api/wallet/transactions/${encodeURIComponent(txid)}/meta`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function lockWallet(): Promise<void> {
  return apiFetch("/api/wallet/lock", { method: "POST" });
}

export function unlockWallet(passphrase: string, timeoutSeconds: number): Promise<void> {
  return apiFetch("/api/wallet/unlock", {
    method: "POST",
    body: JSON.stringify({ passphrase, timeoutSeconds }),
  });
}

export function importMnemonic(input: {
  walletId: string;
  mnemonic: string;
  passphrase?: string;
}): Promise<void> {
  return apiFetch("/api/wallet/import/mnemonic", { method: "POST", body: JSON.stringify(input) });
}
