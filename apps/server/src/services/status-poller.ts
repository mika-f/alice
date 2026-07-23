import {
  classifyRenewal,
  classifyReveal,
  type NodeStatus,
  type NotificationType,
  type OwnedName,
  type RevealCategory,
  type RevealThresholds,
  type TransferState,
  type WalletStatus,
} from "@alice-hns-wallet/domain";
import type { HsdV8Adapter } from "@alice-hns-wallet/hsd-client";
import { isSupportedHsdVersion } from "@alice-hns-wallet/hsd-client";
import type { Db } from "../db/client.js";
import { listWatchedBroadcasts, unwatchBroadcast } from "./broadcast-watch-service.js";
import {
  createNotification,
  getRenewalThresholds,
  getRevealThresholds,
} from "./notification-service.js";
import type { HsdConnectionManager } from "./hsd-connection-manager.js";
import type { RescanTracker } from "./rescan-tracker.js";

/** A watched broadcast missing from the wallet for this long is treated as dropped, not just not-yet-indexed. */
const BROADCAST_FAILURE_GRACE_MS = 10 * 60_000;

/** How long a rescan can run before it's flagged as taking longer than expected. */
const SYNC_DELAY_THRESHOLD_MS = 5 * 60_000;

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
  private readonly lastRevealCategory = new Map<string, RevealCategory>();

  constructor(
    private readonly hsdManager: HsdConnectionManager,
    private readonly db: Db | null = null,
    private readonly intervalMs = 30_000,
    private readonly rescanTracker: RescanTracker | null = null,
    private readonly encryptionKey: string | null = null,
  ) {}

  private notify(input: Parameters<typeof createNotification>[1]): void {
    createNotification(this.db!, input, this.encryptionKey ?? undefined);
  }

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
      if (this.rescanTracker) {
        wallet = { ...wallet, rescanning: this.rescanTracker.get().inProgress };
      }
    } catch (error) {
      walletError = errorMessage(error);
    }

    this.snapshot = { node, nodeError, wallet, walletError, lastUpdated: Date.now() };

    if (this.db) {
      this.checkConnectionNotifications(node, nodeError, walletError);
      await this.checkNameNotifications().catch(() => {
        // Best-effort: a broken name check must never take down the status poll itself.
      });
      await this.checkWatchedBroadcasts().catch(() => {
        // Best-effort: a broken broadcast check must never take down the status poll itself.
      });
      this.checkSyncDelay();
    }

    return this.snapshot;
  }

  /** Only creates a notification on the OK -> problem transition, not on every tick while it persists. */
  private trackProblem(type: NotificationType, isActive: boolean, message: string): void {
    if (isActive) {
      if (!this.activeProblems.has(type)) {
        this.activeProblems.add(type);
        this.notify({ type, message });
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
    const hsd = this.hsdManager.get();
    const names = await hsd.getNames();
    const thresholds = getRenewalThresholds(this.db!);
    const revealThresholds = getRevealThresholds(this.db!);

    for (const item of names) {
      const category = classifyRenewal(item, thresholds);
      const previousCategory = this.lastRenewalCategory.get(item.name);
      if (category !== previousCategory) {
        if (category === "recommended") {
          this.notify({
            type: "renewal-approaching",
            name: item.name,
            message: `${item.name} is approaching its renewal window`,
          });
        } else if (category === "imminent") {
          this.notify({
            type: "expiration-approaching",
            name: item.name,
            message: `${item.name} is close to expiring — renew soon`,
          });
        }
        this.lastRenewalCategory.set(item.name, category);
      }

      const previousTransfer = this.lastTransferState.get(item.name);
      if (previousTransfer !== undefined && previousTransfer !== item.transferState) {
        this.notify({
          type: "transfer-state-changed",
          name: item.name,
          message: `${item.name}'s transfer state changed from ${previousTransfer} to ${item.transferState}`,
        });
        if (item.transferState === "finalizable") {
          this.notify({
            type: "finalize-available",
            name: item.name,
            message: `${item.name}'s transfer can now be finalized`,
          });
        }
      }
      this.lastTransferState.set(item.name, item.transferState);

      await this.checkRevealNotification(hsd, item, revealThresholds);
    }
  }

  /**
   * Spec §27.7: only fires for names *this wallet* has an unrevealed bid on, and only on a
   * category transition. The bulk `OwnedName` already carries state/blocksRemaining, so
   * classification is free; the extra per-name detail fetch (to confirm an own, unrevealed bid)
   * only runs for names already in "revealing" state — a handful at a time, not all ~100.
   */
  private async checkRevealNotification(
    hsd: HsdV8Adapter,
    item: OwnedName,
    thresholds: RevealThresholds,
  ): Promise<void> {
    const category = classifyReveal(item, thresholds);
    const previous = this.lastRevealCategory.get(item.name);
    if (category === previous) return;
    this.lastRevealCategory.set(item.name, category);
    if (category === "none") return;

    const detail = await hsd.getName(item.name);
    const hasUnrevealedOwnBid =
      detail.bids.some((bid) => bid.own) && !detail.reveals.some((reveal) => reveal.own);
    if (!hasUnrevealedOwnBid) return;

    this.notify({
      type: "reveal-deadline-approaching",
      name: item.name,
      message:
        category === "urgent"
          ? `${item.name}'s reveal deadline is imminent — reveal now or forfeit your bid`
          : `${item.name} has entered its reveal window — reveal your bid before it closes`,
    });
  }

  /**
   * Every broadcast made by this app (send/update/renew/transfer/finalize/revoke) is watched
   * until it either confirms or has been missing from the wallet for long enough to call dropped —
   * a brand-new broadcast is expected to be immediately visible (unconfirmed) since the same
   * wallet that broadcast it also recorded it, so "missing" past the grace period is a real signal,
   * not just propagation delay.
   */
  private async checkWatchedBroadcasts(): Promise<void> {
    const watched = listWatchedBroadcasts(this.db!);
    if (watched.length === 0) return;

    const hsd = this.hsdManager.get();
    for (const item of watched) {
      const tx = await hsd.getTransaction(item.txid);
      const label = item.label ? `${item.label} (${item.txid})` : item.txid;

      if (tx && tx.confirmations > 0) {
        this.notify({
          type: "tx-confirmed",
          message: `Transaction confirmed: ${label}`,
        });
        unwatchBroadcast(this.db!, item.txid);
      } else if (!tx && Date.now() - item.createdAt.getTime() > BROADCAST_FAILURE_GRACE_MS) {
        this.notify({
          type: "tx-failed",
          message: `Transaction appears to have failed (dropped from the mempool): ${label}`,
        });
        unwatchBroadcast(this.db!, item.txid);
      }
    }
  }

  /** Announces once per rescan that's still running past the threshold, not on every tick. */
  private checkSyncDelay(): void {
    if (!this.rescanTracker) return;
    const state = this.rescanTracker.get();
    const isDelayed =
      state.inProgress &&
      state.startedAt !== null &&
      Date.now() - state.startedAt > SYNC_DELAY_THRESHOLD_MS;
    this.trackProblem(
      "wallet-sync-delayed",
      isDelayed,
      "Wallet rescan is taking longer than expected",
    );
  }
}
