import { apiFetch } from "./client.js";

export interface AuditLogEntryResponse {
  id: number;
  action: string;
  target: string | null;
  outcome: "success" | "failure";
  detail: string | null;
  ip: string | null;
  createdAt: number;
}

export function listAuditLog(): Promise<AuditLogEntryResponse[]> {
  return apiFetch("/api/audit-log");
}
