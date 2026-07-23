import type { NameDetails, OwnedName, TransactionRecord } from "@alice-hns-wallet/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { watchedBroadcasts } from "../db/schema.js";
import { listWatchedBroadcasts, watchBroadcast } from "./broadcast-watch-service.js";
import { setExternalNotificationSettings } from "./external-notification-service.js";
import { listNotifications } from "./notification-service.js";
import { RescanTracker } from "./rescan-tracker.js";
import { StatusPoller } from "./status-poller.js";

const ENCRYPTION_KEY = "y".repeat(32);

function fakeManager(
  overrides: Partial<{
    status: boolean;
    walletStatus: boolean;
    version: string;
    synced: boolean;
  }> = {},
  names: OwnedName[] = [],
  getTransaction: (txid: string) => Promise<TransactionRecord | null> = async () => null,
  getName: (name: string) => Promise<NameDetails> = async () => {
    throw new Error("getName not stubbed");
  },
) {
  const adapter = {
    getStatus: vi.fn(async () => {
      if (overrides.status === false) throw new Error("node unreachable");
      return {
        connected: true,
        version: overrides.version ?? "8.0.0",
        network: "regtest",
        chainHeight: 100,
        peerCount: 3,
        synced: overrides.synced ?? true,
        progress: overrides.synced === false ? 0.5 : 1,
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
    getNames: vi.fn(async () => names),
    getTransaction: vi.fn(getTransaction),
    getName: vi.fn(getName),
  };
  const manager = { get: () => adapter } as never;
  return { manager, adapter };
}

function ownedName(overrides: Partial<OwnedName> = {}): OwnedName {
  return {
    name: "example",
    state: "owned",
    owned: true,
    renewalHeight: 100,
    expirationHeight: 5100,
    blocksRemaining: 5000,
    transferState: "none",
    resourceSummary: null,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function nameDetails(overrides: Partial<NameDetails> = {}): NameDetails {
  return {
    ...ownedName(),
    nameHash: "abcd",
    ownerAddress: null,
    blockHeight: 100,
    resource: null,
    bids: [],
    reveals: [],
    ...overrides,
  };
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
      const poller = new StatusPoller(manager, null, 1_000);

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
      const poller = new StatusPoller(manager, null, 1_000);

      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      poller.stop();

      const callsAfterStop = adapter.getStatus.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(adapter.getStatus.mock.calls.length).toBe(callsAfterStop);
    });
  });

  describe("notifications (spec §20.1)", () => {
    let db: Db;

    function freshDb(): Db {
      const created = createDb(":memory:");
      runMigrations(created);
      return created;
    }

    it("does nothing when constructed without a db", async () => {
      const { manager } = fakeManager({ status: false });
      const poller = new StatusPoller(manager);
      await poller.refresh();
      // no assertion needed beyond "didn't throw" — there's no db to have written to
    });

    it("creates a node-disconnected notification once, not on every tick", async () => {
      db = freshDb();
      const { manager } = fakeManager({ status: false });
      const poller = new StatusPoller(manager, db);

      await poller.refresh();
      await poller.refresh();
      await poller.refresh();

      const notifications = listNotifications(db);
      expect(notifications.filter((n) => n.type === "node-disconnected")).toHaveLength(1);
    });

    it("clears the tracked problem once it resolves, allowing a fresh notification later", async () => {
      db = freshDb();
      const down = fakeManager({ status: false });
      const pollerDown = new StatusPoller(down.manager, db);
      await pollerDown.refresh();

      // Same poller instance sees the node recover, then fail again.
      const up = fakeManager({ status: true });
      Object.assign(down.adapter, up.adapter);
      await pollerDown.refresh();

      const failAgain = fakeManager({ status: false });
      Object.assign(down.adapter, failAgain.adapter);
      await pollerDown.refresh();

      const notifications = listNotifications(db);
      expect(notifications.filter((n) => n.type === "node-disconnected")).toHaveLength(2);
    });

    it("flags an unsupported hsd version", async () => {
      db = freshDb();
      const { manager } = fakeManager({ version: "7.0.0" });
      const poller = new StatusPoller(manager, db);
      await poller.refresh();

      const notifications = listNotifications(db);
      expect(notifications.some((n) => n.type === "hsd-version-unsupported")).toBe(true);
    });

    it("notifies once a name crosses into the recommended renewal window", async () => {
      db = freshDb();
      const { manager } = fakeManager({}, [ownedName({ name: "example", blocksRemaining: 5000 })]);
      const poller = new StatusPoller(manager, db);
      await poller.refresh();
      expect(listNotifications(db)).toHaveLength(0);

      const { manager: manager2 } = fakeManager({}, [
        ownedName({
          name: "example",
          blocksRemaining: 4000,
          expirationHeight: 100_000,
          renewalHeight: 0,
        }),
      ]);
      const poller2 = new StatusPoller(manager2, db);
      // Re-uses the same db but a fresh poller instance has no memory of "example" yet, so this
      // simulates process restart behavior — the in-memory transition tracking is per-instance.
      await poller2.refresh();

      const notifications = listNotifications(db);
      expect(
        notifications.some((n) => n.type === "renewal-approaching" && n.name === "example"),
      ).toBe(true);
    });

    it("notifies on a transfer state change and flags finalize-available", async () => {
      db = freshDb();
      const { manager, adapter } = fakeManager({}, [
        ownedName({ name: "example", transferState: "pending" }),
      ]);
      const poller = new StatusPoller(manager, db);
      await poller.refresh();
      expect(listNotifications(db)).toHaveLength(0);

      adapter.getNames = vi.fn(async () => [
        ownedName({ name: "example", transferState: "finalizable" }),
      ]);
      await poller.refresh();

      const notifications = listNotifications(db);
      expect(
        notifications.some((n) => n.type === "transfer-state-changed" && n.name === "example"),
      ).toBe(true);
      expect(
        notifications.some((n) => n.type === "finalize-available" && n.name === "example"),
      ).toBe(true);
    });

    it("notifies reveal-deadline-approaching once a name with an own unrevealed bid enters the reveal window", async () => {
      db = freshDb();
      const { manager } = fakeManager(
        {},
        [ownedName({ name: "example", state: "revealing", blocksRemaining: 10 })],
        undefined,
        async () => nameDetails({ bids: [{ value: 100n, lockup: 100n, height: 1, own: true }] }),
      );
      const poller = new StatusPoller(manager, db);
      await poller.refresh();

      const notifications = listNotifications(db);
      expect(
        notifications.some((n) => n.type === "reveal-deadline-approaching" && n.name === "example"),
      ).toBe(true);
    });

    it("does not notify reveal-deadline-approaching when this wallet has no bid on the name", async () => {
      db = freshDb();
      const { manager } = fakeManager(
        {},
        [ownedName({ name: "example", state: "revealing", blocksRemaining: 10 })],
        undefined,
        async () => nameDetails({ bids: [] }),
      );
      const poller = new StatusPoller(manager, db);
      await poller.refresh();

      expect(listNotifications(db).some((n) => n.type === "reveal-deadline-approaching")).toBe(
        false,
      );
    });

    it("does not re-notify reveal-deadline-approaching on every tick while still revealing", async () => {
      db = freshDb();
      const { manager } = fakeManager(
        {},
        [ownedName({ name: "example", state: "revealing", blocksRemaining: 10 })],
        undefined,
        async () => nameDetails({ bids: [{ value: 100n, lockup: 100n, height: 1, own: true }] }),
      );
      const poller = new StatusPoller(manager, db);
      await poller.refresh();
      await poller.refresh();
      await poller.refresh();

      expect(
        listNotifications(db).filter((n) => n.type === "reveal-deadline-approaching"),
      ).toHaveLength(1);
    });

    it("does not notify reveal-deadline-approaching once this wallet's bid has already been revealed", async () => {
      db = freshDb();
      const { manager } = fakeManager(
        {},
        [ownedName({ name: "example", state: "revealing", blocksRemaining: 10 })],
        undefined,
        async () =>
          nameDetails({
            bids: [{ value: 100n, lockup: 100n, height: 1, own: true }],
            reveals: [{ value: 100n, height: 2, own: true }],
          }),
      );
      const poller = new StatusPoller(manager, db);
      await poller.refresh();

      expect(listNotifications(db).some((n) => n.type === "reveal-deadline-approaching")).toBe(
        false,
      );
    });
  });

  describe("watched broadcasts (spec Phase 5: tx-confirmed/tx-failed)", () => {
    function freshDb(): Db {
      const created = createDb(":memory:");
      runMigrations(created);
      return created;
    }

    it("notifies tx-confirmed and unwatches once the tx has confirmations", async () => {
      const db = freshDb();
      watchBroadcast(db, "a".repeat(64), "example");

      const { manager } = fakeManager({}, [], async (txid) => ({
        txid,
        kind: "send",
        amount: 100n,
        fee: 10n,
        timestamp: Date.now(),
        blockHeight: 100,
        confirmations: 1,
        status: "confirmed",
        inputs: [],
        outputs: [],
      }));
      const poller = new StatusPoller(manager, db);
      await poller.refresh();

      const notifications = listNotifications(db);
      expect(notifications.some((n) => n.type === "tx-confirmed")).toBe(true);
      expect(listWatchedBroadcasts(db)).toHaveLength(0);
    });

    it("leaves an unconfirmed-but-found tx watched without notifying", async () => {
      const db = freshDb();
      watchBroadcast(db, "b".repeat(64));

      const { manager } = fakeManager({}, [], async (txid) => ({
        txid,
        kind: "send",
        amount: 100n,
        fee: 10n,
        timestamp: Date.now(),
        blockHeight: -1,
        confirmations: 0,
        status: "pending",
        inputs: [],
        outputs: [],
      }));
      const poller = new StatusPoller(manager, db);
      await poller.refresh();

      expect(listNotifications(db)).toHaveLength(0);
      expect(listWatchedBroadcasts(db)).toHaveLength(1);
    });

    it("notifies tx-failed only after a missing tx has aged past the grace period", async () => {
      const db = freshDb();
      const txid = "c".repeat(64);
      watchBroadcast(db, txid);
      // Backdate createdAt well past the grace period, simulating a tx that's been missing a while.
      db.update(watchedBroadcasts)
        .set({ createdAt: new Date(Date.now() - 60 * 60_000) })
        .run();

      const { manager } = fakeManager({}, [], async () => null);
      const poller = new StatusPoller(manager, db);
      await poller.refresh();

      const notifications = listNotifications(db);
      expect(notifications.some((n) => n.type === "tx-failed")).toBe(true);
      expect(listWatchedBroadcasts(db)).toHaveLength(0);
    });

    it("does not flag a freshly missing tx as failed yet", async () => {
      const db = freshDb();
      watchBroadcast(db, "d".repeat(64));

      const { manager } = fakeManager({}, [], async () => null);
      const poller = new StatusPoller(manager, db);
      await poller.refresh();

      expect(listNotifications(db).some((n) => n.type === "tx-failed")).toBe(false);
      expect(listWatchedBroadcasts(db)).toHaveLength(1);
    });
  });

  describe("wallet-sync-delayed (spec Phase 5)", () => {
    function freshDb(): Db {
      const created = createDb(":memory:");
      runMigrations(created);
      return created;
    }

    it("notifies once a rescan has been running past the threshold", async () => {
      const db = freshDb();
      const rescanTracker = new RescanTracker();
      // Simulate a rescan that started 10 minutes ago, well past the 5-minute threshold.
      void rescanTracker.track(() => new Promise(() => {}));
      Object.assign(rescanTracker.get(), { startedAt: Date.now() - 10 * 60_000 });

      const { manager } = fakeManager();
      const poller = new StatusPoller(manager, db, undefined, rescanTracker);
      await poller.refresh();

      const notifications = listNotifications(db);
      expect(notifications.some((n) => n.type === "wallet-sync-delayed")).toBe(true);
    });

    it("does not notify while a rescan is still within the threshold", async () => {
      const db = freshDb();
      const rescanTracker = new RescanTracker();
      void rescanTracker.track(() => new Promise(() => {}));

      const { manager } = fakeManager();
      const poller = new StatusPoller(manager, db, undefined, rescanTracker);
      await poller.refresh();

      expect(listNotifications(db).some((n) => n.type === "wallet-sync-delayed")).toBe(false);
    });
  });

  describe("external notification fan-out (spec §20.2)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function freshDb(): Db {
      const created = createDb(":memory:");
      runMigrations(created);
      return created;
    }

    it("fans an in-app notification out externally when an encryptionKey is supplied", async () => {
      const db = freshDb();
      setExternalNotificationSettings(db, ENCRYPTION_KEY, {
        ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
        discord: { enabled: false, url: "" },
      });
      const fetchSpy = vi.fn(
        async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchSpy);

      const { manager } = fakeManager({ status: false });
      const poller = new StatusPoller(manager, db, undefined, null, ENCRYPTION_KEY);
      await poller.refresh();

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
        body: expect.stringContaining("Node is unreachable"),
      });
    });

    it("does not fan out when no encryptionKey is supplied", async () => {
      const db = freshDb();
      setExternalNotificationSettings(db, ENCRYPTION_KEY, {
        ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
        discord: { enabled: false, url: "" },
      });
      const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);

      const { manager } = fakeManager({ status: false });
      const poller = new StatusPoller(manager, db);
      await poller.refresh();

      expect(listNotifications(db).length).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
