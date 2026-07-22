import { describe, expect, it } from "vitest";
import type { StatusSnapshot } from "./status-poller.js";
import { computeDashboardWarnings } from "./dashboard-warnings.js";

const RECENT_BACKUP = Date.now() - 24 * 60 * 60_000;

function baseSnapshot(): StatusSnapshot {
  return {
    node: {
      connected: true,
      version: "8.0.0",
      network: "regtest",
      chainHeight: 100,
      peerCount: 3,
      synced: true,
      progress: 1,
    },
    nodeError: null,
    wallet: {
      connected: true,
      walletId: "primary",
      network: "regtest",
      walletHeight: 100,
      locked: false,
      rescanning: false,
    },
    walletError: null,
    lastUpdated: Date.now(),
  };
}

describe("computeDashboardWarnings", () => {
  it("returns nothing when everything is healthy and backup was recently confirmed", () => {
    expect(computeDashboardWarnings(baseSnapshot(), RECENT_BACKUP)).toEqual([]);
  });

  it("flags a never-confirmed backup", () => {
    const warnings = computeDashboardWarnings(baseSnapshot(), null);
    expect(warnings).toEqual([
      { type: "backup-stale", message: "Backup has never been confirmed" },
    ]);
  });

  it("flags a stale backup confirmation past 30 days", () => {
    const stale = Date.now() - 31 * 24 * 60 * 60_000;
    const warnings = computeDashboardWarnings(baseSnapshot(), stale);
    expect(warnings).toEqual([
      { type: "backup-stale", message: "Backup confirmation is overdue (30+ days)" },
    ]);
  });

  it("flags node/wallet disconnection from the respective error fields", () => {
    const snapshot = baseSnapshot();
    snapshot.node = null;
    snapshot.nodeError = "timeout";
    snapshot.wallet = null;
    snapshot.walletError = "connection refused";
    const warnings = computeDashboardWarnings(snapshot, RECENT_BACKUP);
    expect(warnings).toEqual([
      { type: "node-disconnected", message: "Node is unreachable: timeout" },
      { type: "wallet-disconnected", message: "Wallet is unreachable: connection refused" },
    ]);
  });

  it("flags node-unsynced when the node reports not synced", () => {
    const snapshot = baseSnapshot();
    snapshot.node!.synced = false;
    snapshot.node!.progress = 0.42;
    const warnings = computeDashboardWarnings(snapshot, RECENT_BACKUP);
    expect(warnings).toEqual([{ type: "node-unsynced", message: "Node sync has stalled at 42%" }]);
  });

  it("flags wallet-unsynced while a rescan is in progress", () => {
    const snapshot = baseSnapshot();
    snapshot.wallet!.rescanning = true;
    const warnings = computeDashboardWarnings(snapshot, RECENT_BACKUP);
    expect(warnings).toEqual([{ type: "wallet-unsynced", message: "Wallet is rescanning" }]);
  });

  it("flags a network mismatch between node and wallet", () => {
    const snapshot = baseSnapshot();
    snapshot.wallet!.network = "main";
    const warnings = computeDashboardWarnings(snapshot, RECENT_BACKUP);
    expect(warnings).toEqual([
      { type: "network-mismatch", message: "Node is on regtest but wallet is on main" },
    ]);
  });

  it("flags a locked wallet", () => {
    const snapshot = baseSnapshot();
    snapshot.wallet!.locked = true;
    const warnings = computeDashboardWarnings(snapshot, RECENT_BACKUP);
    expect(warnings).toEqual([{ type: "wallet-locked", message: "Wallet is locked" }]);
  });

  it("flags an unsupported hsd version", () => {
    const snapshot = baseSnapshot();
    snapshot.node!.version = "7.0.0";
    const warnings = computeDashboardWarnings(snapshot, RECENT_BACKUP);
    expect(warnings).toEqual([
      { type: "hsd-version-unsupported", message: "hsd 7.0.0 is not a supported 8.x version" },
    ]);
  });
});
