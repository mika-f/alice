export interface RescanState {
  inProgress: boolean;
  startedAt: number | null;
}

/**
 * hsd's wallet HTTP API exposes no rescan-progress signal — its own `POST /rescan` doesn't even
 * respond until the rescan is fully done — so this tracks the app's own in-flight rescan calls,
 * giving `getWalletStatus()`/the status poller something better than an always-false `rescanning`
 * flag. In-memory only (resets on restart), same tradeoff as StatusPoller's notification state.
 */
export class RescanTracker {
  private state: RescanState = { inProgress: false, startedAt: null };

  get(): RescanState {
    return this.state;
  }

  async track<T>(fn: () => Promise<T>): Promise<T> {
    this.state = { inProgress: true, startedAt: Date.now() };
    try {
      return await fn();
    } finally {
      this.state = { inProgress: false, startedAt: null };
    }
  }
}
