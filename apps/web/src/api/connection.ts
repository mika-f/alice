import type { ConnectionConfig, ConnectionTestResult } from "@alice-hns-wallet/schemas";
import { apiFetch } from "./client.js";

export type SafeConnection = Omit<ConnectionConfig, "nodeApiKey" | "walletApiKey">;

export function getConnection(): Promise<SafeConnection> {
  return apiFetch<SafeConnection>("/api/connection");
}

export function testConnection(input: ConnectionConfig): Promise<ConnectionTestResult> {
  return apiFetch("/api/connection/test", { method: "POST", body: JSON.stringify(input) });
}

export function saveConnection(input: ConnectionConfig): Promise<SafeConnection> {
  return apiFetch("/api/connection", { method: "PUT", body: JSON.stringify(input) });
}
