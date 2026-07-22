import { apiFetch } from "./client.js";

export interface ExternalNotificationChannelStatus {
  enabled: boolean;
  configured: boolean;
}

export interface ExternalNotificationStatusResponse {
  ntfy: ExternalNotificationChannelStatus;
  discord: ExternalNotificationChannelStatus;
}

export interface ExternalNotificationChannelInput {
  enabled: boolean;
  url: string;
}

export interface ExternalNotificationSettingsInput {
  ntfy: ExternalNotificationChannelInput;
  discord: ExternalNotificationChannelInput;
}

export function getExternalNotificationSettings(): Promise<ExternalNotificationStatusResponse> {
  return apiFetch("/api/settings/external-notifications");
}

export function setExternalNotificationSettings(
  input: ExternalNotificationSettingsInput,
): Promise<ExternalNotificationStatusResponse> {
  return apiFetch("/api/settings/external-notifications", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function sendTestExternalNotification(): Promise<{
  ntfy: boolean | null;
  discord: boolean | null;
}> {
  return apiFetch("/api/settings/external-notifications/test", { method: "POST" });
}
