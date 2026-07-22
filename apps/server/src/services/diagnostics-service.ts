import { isSupportedHsdVersion } from "@alice-hns-wallet/hsd-client";
import type { NodeStatus, WalletStatus } from "@alice-hns-wallet/domain";
import type { Db } from "../db/client.js";
import type { Env } from "../env.js";
import {
  getActiveConnection,
  toSafeConnection,
  type SafeConnection,
} from "./connection-service.js";
import { getLastBackupConfirmedAt } from "./backup-service.js";
import { computeDashboardWarnings, type DashboardWarning } from "./dashboard-warnings.js";
import type { HsdConnectionManager } from "./hsd-connection-manager.js";
import type { StatusSnapshot } from "./status-poller.js";

export interface DiagnosticsResult {
  connection: SafeConnection;
  node: { reachable: boolean; error: string | null; status: NodeStatus | null };
  wallet: { reachable: boolean; error: string | null; status: WalletStatus | null };
  networkMatches: boolean | null;
  hsdVersionSupported: boolean | null;
  warnings: DashboardWarning[];
  checkedAt: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Unlike `/api/status` (which reads the status poller's cached snapshot, up to 30s stale), this
 * hits hsd directly every call — appropriate for a diagnostics screen the user opens specifically
 * to check "is it working right now". Reuses computeDashboardWarnings so the warning logic isn't
 * duplicated between the dashboard and this screen.
 */
export async function getDiagnostics(
  db: Db,
  env: Env,
  hsdManager: HsdConnectionManager,
): Promise<DiagnosticsResult> {
  const connection = getActiveConnection(db, env, env.ENCRYPTION_KEY);
  const hsd = hsdManager.get();

  let node: NodeStatus | null = null;
  let nodeError: string | null = null;
  try {
    node = await hsd.getStatus();
  } catch (error) {
    nodeError = errorMessage(error);
  }

  let wallet: WalletStatus | null = null;
  let walletError: string | null = null;
  try {
    wallet = await hsd.getWalletStatus();
  } catch (error) {
    walletError = errorMessage(error);
  }

  const snapshot: StatusSnapshot = {
    node,
    nodeError,
    wallet,
    walletError,
    lastUpdated: Date.now(),
  };
  const warnings = computeDashboardWarnings(snapshot, getLastBackupConfirmedAt(db));

  return {
    connection: toSafeConnection(connection),
    node: { reachable: node !== null, error: nodeError, status: node },
    wallet: { reachable: wallet !== null, error: walletError, status: wallet },
    networkMatches: node && wallet ? node.network === wallet.network : null,
    hsdVersionSupported: node ? isSupportedHsdVersion(node.version) : null,
    warnings,
    checkedAt: Date.now(),
  };
}
