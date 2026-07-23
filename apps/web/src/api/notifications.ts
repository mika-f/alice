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
