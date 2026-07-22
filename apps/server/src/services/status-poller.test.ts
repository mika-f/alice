import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusPoller } from "./status-poller.js";

function fakeManager(overrides: Partial<{ status: boolean; balance: boolean }> = {}) {
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
    getBalance: vi.fn(async () => {
      if (overrides.balance === false) throw new Error("wallet unreachable");
      return { confirmed: 0n, unconfirmed: 0n, locked: 0n, spendable: 0n };
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
      walletConnected: false,
      walletError: null,
      lastUpdated: 0,
    });
  });

  it("refresh() populates node and wallet state on success", async () => {
    const poller = new StatusPoller(fakeManager().manager);
    const snapshot = await poller.refresh();
    expect(snapshot.node?.connected).toBe(true);
    expect(snapshot.node?.chainHeight).toBe(100);
    expect(snapshot.walletConnected).toBe(true);
    expect(snapshot.lastUpdated).toBeGreaterThan(0);
  });

  it("refresh() records errors without throwing when hsd is unreachable", async () => {
    const poller = new StatusPoller(fakeManager({ status: false, balance: false }).manager);
    const snapshot = await poller.refresh();
    expect(snapshot.node).toBeNull();
    expect(snapshot.nodeError).toContain("node unreachable");
    expect(snapshot.walletConnected).toBe(false);
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
