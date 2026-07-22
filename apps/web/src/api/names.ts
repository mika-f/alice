import { apiFetch } from "./client.js";

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
