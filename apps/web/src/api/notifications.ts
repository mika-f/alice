import { apiFetch } from "./client.js";

export interface AppNotificationResponse {
  id: number;
  type: string;
  name: string | null;
  message: string;
  createdAt: number;
  readAt: number | null;
}

export function listNotifications(): Promise<AppNotificationResponse[]> {
  return apiFetch("/api/notifications");
}

export function markNotificationRead(id: number): Promise<void> {
  return apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
}

export interface RenewalThresholdsResponse {
  blocksRemaining: number;
  daysRemaining: number;
  expirationRatio: number;
}

export function getRenewalThresholds(): Promise<RenewalThresholdsResponse> {
  return apiFetch("/api/settings/notifications");
}

export function setRenewalThresholds(input: RenewalThresholdsResponse): Promise<void> {
  return apiFetch("/api/settings/notifications", { method: "PUT", body: JSON.stringify(input) });
}

export interface RevealThresholdsResponse {
  blocksRemaining: number;
}

export function getRevealThresholds(): Promise<RevealThresholdsResponse> {
  return apiFetch("/api/settings/reveal-thresholds");
}

export function setRevealThresholds(input: RevealThresholdsResponse): Promise<void> {
  return apiFetch("/api/settings/reveal-thresholds", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export interface AutoRevealSettingsResponse {
  enabled: boolean;
  passphraseConfigured: boolean;
}

export function getAutoRevealSettings(): Promise<AutoRevealSettingsResponse> {
  return apiFetch("/api/settings/auto-reveal");
}

export function setAutoRevealSettings(input: {
  enabled: boolean;
  passphrase: string;
}): Promise<AutoRevealSettingsResponse> {
  return apiFetch("/api/settings/auto-reveal", { method: "PUT", body: JSON.stringify(input) });
}

export type AutoRedeemSettingsResponse = AutoRevealSettingsResponse;

export function getAutoRedeemSettings(): Promise<AutoRedeemSettingsResponse> {
  return apiFetch("/api/settings/auto-redeem");
}

export function setAutoRedeemSettings(input: {
  enabled: boolean;
  passphrase: string;
}): Promise<AutoRedeemSettingsResponse> {
  return apiFetch("/api/settings/auto-redeem", { method: "PUT", body: JSON.stringify(input) });
}

export interface AutoBidSettingsResponse {
  timing: "next-block" | "before-reveal";
  increment: string;
  passphraseConfigured: boolean;
}

export function getAutoBidSettings(): Promise<AutoBidSettingsResponse> {
  return apiFetch("/api/settings/auto-bid");
}

export function setAutoBidSettings(input: {
  timing: "next-block" | "before-reveal";
  increment: string;
  passphrase: string;
}): Promise<AutoBidSettingsResponse> {
  return apiFetch("/api/settings/auto-bid", { method: "PUT", body: JSON.stringify(input) });
}
