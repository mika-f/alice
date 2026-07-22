import type { NodeStatus } from "@alice-hns-wallet/domain";
import type { HsdConnectionManager } from "./hsd-connection-manager.js";

export interface StatusSnapshot {
  node: NodeStatus | null;
  nodeError: string | null;
  walletConnected: boolean;
  walletError: string | null;
  lastUpdated: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EMPTY_SNAPSHOT: StatusSnapshot = {
  node: null,
  nodeError: null,
  walletConnected: false,
  walletError: null,
  lastUpdated: 0,
};

/**
 * Spec §8.5: periodically refreshes node/wallet status. `refresh()` is exposed
 * separately so write-route handlers can force a non-cached check before acting.
 */
export class StatusPoller {
  private snapshot: StatusSnapshot = EMPTY_SNAPSHOT;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly hsdManager: HsdConnectionManager,
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

    let walletConnected = false;
    let walletError: string | null = null;
    try {
      await hsd.getBalance();
      walletConnected = true;
    } catch (error) {
      walletError = errorMessage(error);
    }

    this.snapshot = { node, nodeError, walletConnected, walletError, lastUpdated: Date.now() };
    return this.snapshot;
  }
}
