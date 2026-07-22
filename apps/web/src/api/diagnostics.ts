import type { SafeConnection } from "./connection.js";
import { apiFetch } from "./client.js";

interface NodeStatusInfo {
  connected: boolean;
  version: string;
  network: string;
  chainHeight: number;
  peerCount: number;
  synced: boolean;
  progress: number;
}

interface WalletStatusInfo {
  connected: boolean;
  walletId: string;
  network: string;
  walletHeight: number;
  locked: boolean;
  rescanning: boolean;
}

export interface DashboardWarning {
  type: string;
  message: string;
}

export interface DiagnosticsResponse {
  connection: SafeConnection;
  node: { reachable: boolean; error: string | null; status: NodeStatusInfo | null };
  wallet: { reachable: boolean; error: string | null; status: WalletStatusInfo | null };
  networkMatches: boolean | null;
  hsdVersionSupported: boolean | null;
  warnings: DashboardWarning[];
  checkedAt: number;
}

export function getDiagnostics(): Promise<DiagnosticsResponse> {
  return apiFetch("/api/diagnostics");
}
