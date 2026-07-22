import { isSupportedHsdVersion } from "@alice-hns-wallet/hsd-client";
import type { StatusSnapshot } from "./status-poller.js";

/**
 * Spec §10.3's warning list. Two of its items (Renewal 接近 / Finalize 可能) are deliberately
 * left out here — they need the full ~100-name list, which the dashboard doesn't otherwise fetch
 * (§14.1's single-bulk-request rule), and they're already surfaced via the Notifications page.
 * Everything else here is a *live* condition (recomputed from the current status snapshot on every
 * poll), unlike the notification system which only fires once on a state transition.
 */
export type DashboardWarningType =
  | "node-disconnected"
  | "wallet-disconnected"
  | "node-unsynced"
  | "wallet-unsynced"
  | "network-mismatch"
  | "wallet-locked"
  | "hsd-version-unsupported"
  | "backup-stale";

export interface DashboardWarning {
  type: DashboardWarningType;
  message: string;
}

const BACKUP_STALE_MS = 30 * 24 * 60 * 60_000;

export function computeDashboardWarnings(
  snapshot: StatusSnapshot,
  lastBackupConfirmedAt: number | null,
): DashboardWarning[] {
  const { node, nodeError, wallet, walletError } = snapshot;
  const warnings: DashboardWarning[] = [];

  if (nodeError) {
    warnings.push({ type: "node-disconnected", message: `Node is unreachable: ${nodeError}` });
  }
  if (walletError) {
    warnings.push({
      type: "wallet-disconnected",
      message: `Wallet is unreachable: ${walletError}`,
    });
  }
  if (node && !node.synced) {
    warnings.push({
      type: "node-unsynced",
      message: `Node sync has stalled at ${Math.round(node.progress * 100)}%`,
    });
  }
  if (wallet?.rescanning) {
    warnings.push({ type: "wallet-unsynced", message: "Wallet is rescanning" });
  }
  if (node?.network && wallet?.network && node.network !== wallet.network) {
    warnings.push({
      type: "network-mismatch",
      message: `Node is on ${node.network} but wallet is on ${wallet.network}`,
    });
  }
  if (wallet?.locked) {
    warnings.push({ type: "wallet-locked", message: "Wallet is locked" });
  }
  if (node && !isSupportedHsdVersion(node.version)) {
    warnings.push({
      type: "hsd-version-unsupported",
      message: `hsd ${node.version} is not a supported 8.x version`,
    });
  }

  const backupStale =
    lastBackupConfirmedAt === null || Date.now() - lastBackupConfirmedAt > BACKUP_STALE_MS;
  if (backupStale) {
    warnings.push({
      type: "backup-stale",
      message:
        lastBackupConfirmedAt === null
          ? "Backup has never been confirmed"
          : "Backup confirmation is overdue (30+ days)",
    });
  }

  return warnings;
}
