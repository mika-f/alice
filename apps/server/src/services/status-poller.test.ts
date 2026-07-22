import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusPoller } from "./status-poller.js";

function fakeManager(overrides: Partial<{ status: boolean; walletStatus: boolean }> = {}) {
  const adapter = {
    getStatus: vi.fn(async () => {
      if (overrides.status === false) throw new Error("node unreachable");
      return {
        connected: true,
        version: "8.0.0",
        network: "regtest",
        chainHeight: 100,
        peerCount: 3,
        synced: true,
        progress: 1,
      };
    }),
    getWalletStatus: vi.fn(async () => {
      if (overrides.walletStatus === false) throw new Error("wallet unreachable");
      return {
        connected: true,
        walletId: "primary",
        network: "regtest",
        walletHeight: 100,
        locked: false,
        rescanning: false,
      };
    }),
  };
  const manager = { get: () => adapter } as never;
  return { manager, adapter };
}

describe("StatusPoller", () => {
  it("has an empty snapshot before the first refresh", () => {
    const poller = new StatusPoller(fakeManager().manager);
    expect(poller.getSnapshot()).toEqual({
      node: null,
      nodeError: null,
      wallet: null,
      walletError: null,
      lastUpdated: 0,
    });
  });

  it("refresh() populates node and wallet state on success", async () => {
    const poller = new StatusPoller(fakeManager().manager);
    const snapshot = await poller.refresh();
    expect(snapshot.node?.connected).toBe(true);
    expect(snapshot.node?.chainHeight).toBe(100);
    expect(snapshot.wallet?.locked).toBe(false);
    expect(snapshot.lastUpdated).toBeGreaterThan(0);
  });

  it("refresh() records errors without throwing when hsd is unreachable", async () => {
    const poller = new StatusPoller(fakeManager({ status: false, walletStatus: false }).manager);
    const snapshot = await poller.refresh();
    expect(snapshot.node).toBeNull();
    expect(snapshot.nodeError).toContain("node unreachable");
    expect(snapshot.wallet).toBeNull();
    expect(snapshot.walletError).toContain("wallet unreachable");
  });

  describe("start/stop", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("polls immediately on start and again after the interval", async () => {
      vi.useFakeTimers();
      const { manager, adapter } = fakeManager();
      const poller = new StatusPoller(manager, 1_000);

      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(poller.getSnapshot().node).not.toBeNull();

      const callsAfterStart = adapter.getStatus.mock.calls.length;

      await vi.advanceTimersByTimeAsync(1_000);
      expect(adapter.getStatus.mock.calls.length).toBeGreaterThan(callsAfterStart);

      poller.stop();
    });

    it("stop() prevents further polling", async () => {
      vi.useFakeTimers();
      const { manager, adapter } = fakeManager();
      const poller = new StatusPoller(manager, 1_000);

      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      poller.stop();

      const callsAfterStop = adapter.getStatus.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(adapter.getStatus.mock.calls.length).toBe(callsAfterStop);
    });
  });
});
