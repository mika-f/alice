import { apiFetch } from "./client.js";

export interface BackupStatusResponse {
  lastConfirmedAt: number | null;
}

export function getBackupStatus(): Promise<BackupStatusResponse> {
  return apiFetch("/api/settings/backup");
}

export function confirmBackup(): Promise<BackupStatusResponse> {
  return apiFetch("/api/settings/backup/confirm", { method: "POST" });
}
