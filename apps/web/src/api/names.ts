import { apiFetch } from "./client.js";
import type { BroadcastResultResponse } from "./wallet.js";

export type { BroadcastResultResponse } from "./wallet.js";

export interface OwnedNameResponse {
  name: string;
  state: string;
  owned: boolean;
  renewalHeight: number;
  expirationHeight: number;
  blocksRemaining: number;
  transferState: string;
  resourceSummary: string | null;
  label?: string;
  memo?: string;
  updatedAt: number;
}

export type DnsRecordResponse =
  | { type: "NS"; ns: string }
  | { type: "GLUE4"; ns: string; address: string }
  | { type: "GLUE6"; ns: string; address: string }
  | { type: "DS"; keyTag: number; algorithm: number; digestType: number; digest: string }
  | { type: "TXT"; text: string[] }
  | { type: "SYNTH4"; address: string }
  | { type: "SYNTH6"; address: string }
  | { type: "UNKNOWN"; raw: string };

export interface NameResourceResponse {
  records: DnsRecordResponse[];
  raw: string;
  size: number;
}

export interface NameBidResponse {
  /** The true bid amount; null when it's another bidder's still-blinded bid. */
  value: string | null;
  lockup: string;
  height: number;
  own: boolean;
}

export interface NameRevealResponse {
  value: string;
  height: number;
  own: boolean;
}

export interface NameDetailsResponse extends OwnedNameResponse {
  nameHash: string;
  ownerAddress: string | null;
  blockHeight: number;
  resource: NameResourceResponse | null;
  bids: NameBidResponse[];
  reveals: NameRevealResponse[];
}

export function listNames(): Promise<OwnedNameResponse[]> {
  return apiFetch("/api/names");
}

export function getName(name: string): Promise<NameDetailsResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}`);
}

export function getNameResource(name: string): Promise<NameResourceResponse | null> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/resource`);
}

export function setNameMeta(name: string, input: { label?: string; memo?: string }): Promise<void> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/meta`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export interface UpdatePreviewResponse {
  fee: string;
  resource: NameResourceResponse;
}

export function previewUpdateName(
  name: string,
  records: DnsRecordResponse[],
): Promise<UpdatePreviewResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/update/preview`, {
    method: "POST",
    body: JSON.stringify({ records }),
  });
}

export function updateName(
  name: string,
  records: DnsRecordResponse[],
): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/update`, {
    method: "POST",
    body: JSON.stringify({ records }),
  });
}

export function previewRenewName(name: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/renew/preview`, { method: "POST" });
}

export function renewName(name: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/renew`, { method: "POST" });
}

export interface NameActionResultResponse {
  name: string;
  status: "success" | "failed" | "skipped";
  txid?: string;
  reason?: string;
}

export function renewNamesBatch(names: string[]): Promise<NameActionResultResponse[]> {
  return apiFetch("/api/names/renew-batch", { method: "POST", body: JSON.stringify({ names }) });
}

export function previewTransferName(
  name: string,
  address: string,
): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/transfer/preview`, {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export function transferName(name: string, address: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/transfer`, {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export function previewFinalizeName(name: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/finalize/preview`, { method: "POST" });
}

export function finalizeName(name: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/finalize`, { method: "POST" });
}

export function revokeName(
  name: string,
  input: { password: string; code: string },
): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/revoke`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface NameAvailabilityResponse {
  name: string;
  available: boolean;
  reserved: boolean;
  state: string | null;
}

export function getNameAvailability(name: string): Promise<NameAvailabilityResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/availability`);
}

export function previewOpenName(name: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/open/preview`, { method: "POST" });
}

export function openName(name: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/open`, { method: "POST" });
}

export interface BidInput {
  /** HNS decimal strings — converted with parseHnsToSmallestUnit before this call. */
  bid: string;
  lockup: string;
}

export function previewBidName(name: string, input: BidInput): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/bid/preview`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function bidName(name: string, input: BidInput): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/bid`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function previewRevealName(name: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/reveal/preview`, { method: "POST" });
}

export function revealName(name: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/reveal`, { method: "POST" });
}

export function previewRedeemName(name: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/redeem/preview`, { method: "POST" });
}

export function redeemName(name: string): Promise<BroadcastResultResponse> {
  return apiFetch(`/api/names/${encodeURIComponent(name)}/redeem`, { method: "POST" });
}
