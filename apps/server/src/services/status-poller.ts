import {
  classifyRenewal,
  type NodeStatus,
  type NotificationType,
  type TransferState,
  type WalletStatus,
} from "@alice-hns-wallet/domain";
import { isSupportedHsdVersion } from "@alice-hns-wallet/hsd-client";
import type { Db } from "../db/client.js";
import { createNotification, getRenewalThresholds } from "./notification-service.js";
import type { HsdConnectionManager } from "./hsd-connection-manager.js";

export interface StatusSnapshot {
  node: NodeStatus | null;
  nodeError: string | null;
  wallet: WalletStatus | null;
  walletError: string | null;
  lastUpdated: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EMPTY_SNAPSHOT: StatusSnapshot = {
  node: null,
  nodeError: null,
  wallet: null,
  walletError: null,
  lastUpdated: 0,
};

/**
 * Spec §8.5: periodically refreshes node/wallet status. `refresh()` is exposed
 * separately so write-route handlers can force a non-cached check before acting.
 *
 * Also generates in-app notifications (spec §20.1) when `db` is supplied. Notification state
 * (which problems/categories were last seen) is tracked in memory only — it resets on restart,
 * which just means an ongoing problem may be re-announced once rather than being lost forever.
 */
export class StatusPoller {
  private snapshot: StatusSnapshot = EMPTY_SNAPSHOT;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly activeProblems = new Set<NotificationType>();
  private readonly lastRenewalCategory = new Map<string, string>();
  private readonly lastTransferState = new Map<string, TransferState>();

  constructor(
    private readonly hsdManager: HsdConnectionManager,
    private readonly db: Db | null = null,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSnapshot(): StatusSnapshot {
    return this.snapshot;
  }

  async refresh(): Promise<StatusSnapshot> {
    const hsd = this.hsdManager.get();

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

    this.snapshot = { node, nodeError, wallet, walletError, lastUpdated: Date.now() };

    if (this.db) {
      this.checkConnectionNotifications(node, nodeError, walletError);
      await this.checkNameNotifications().catch(() => {
        // Best-effort: a broken name check must never take down the status poll itself.
      });
    }

    return this.snapshot;
  }

  /** Only creates a notification on the OK -> problem transition, not on every tick while it persists. */
  private trackProblem(type: NotificationType, isActive: boolean, message: string): void {
    if (isActive) {
      if (!this.activeProblems.has(type)) {
        this.activeProblems.add(type);
        createNotification(this.db!, { type, message });
      }
    } else {
      this.activeProblems.delete(type);
    }
  }

  private checkConnectionNotifications(
    node: NodeStatus | null,
    nodeError: string | null,
    walletError: string | null,
  ): void {
    this.trackProblem("node-disconnected", nodeError !== null, `Node is unreachable: ${nodeError}`);
    this.trackProblem(
      "wallet-disconnected",
      walletError !== null,
      `Wallet is unreachable: ${walletError}`,
    );
    this.trackProblem(
      "node-sync-stalled",
      node !== null && !node.synced,
      `Node sync has stalled at ${Math.round((node?.progress ?? 0) * 100)}%`,
    );
    this.trackProblem(
      "hsd-version-unsupported",
      node !== null && !isSupportedHsdVersion(node.version),
      `hsd ${node?.version} is not a supported 8.x version`,
    );
  }

  private async checkNameNotifications(): Promise<void> {
    const names = await this.hsdManager.get().getNames();
    const thresholds = getRenewalThresholds(this.db!);

    for (const item of names) {
      const category = classifyRenewal(item, thresholds);
      const previousCategory = this.lastRenewalCategory.get(item.name);
      if (category !== previousCategory) {
        if (category === "recommended") {
          createNotification(this.db!, {
            type: "renewal-approaching",
            name: item.name,
            message: `${item.name} is approaching its renewal window`,
          });
        } else if (category === "imminent") {
          createNotification(this.db!, {
            type: "expiration-approaching",
            name: item.name,
            message: `${item.name} is close to expiring — renew soon`,
          });
        }
        this.lastRenewalCategory.set(item.name, category);
      }

      const previousTransfer = this.lastTransferState.get(item.name);
      if (previousTransfer !== undefined && previousTransfer !== item.transferState) {
        createNotification(this.db!, {
          type: "transfer-state-changed",
          name: item.name,
          message: `${item.name}'s transfer state changed from ${previousTransfer} to ${item.transferState}`,
        });
        if (item.transferState === "finalizable") {
          createNotification(this.db!, {
            type: "finalize-available",
            name: item.name,
            message: `${item.name}'s transfer can now be finalized`,
          });
        }
      }
      this.lastTransferState.set(item.name, item.transferState);
    }
  }
}
