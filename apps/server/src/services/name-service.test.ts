import type { NameDetails, OwnedName } from "@alice-hns-wallet/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { nameCache } from "../db/schema.js";
import {
  getNameDetail,
  getNameResource,
  listNames,
  renewNamesBatch,
  setNameMeta,
} from "./name-service.js";

function ownedName(overrides: Partial<OwnedName> = {}): OwnedName {
  return {
    name: "example",
    state: "owned",
    owned: true,
    renewalHeight: 100,
    expirationHeight: 5100,
    blocksRemaining: 5000,
    transferState: "none",
    resourceSummary: "12 bytes",
    updatedAt: Date.now(),
    ...overrides,
  };
}

function nameDetails(overrides: Partial<NameDetails> = {}): NameDetails {
  return {
    ...ownedName(),
    nameHash: "abcd",
    ownerAddress: "rs1qowner",
    blockHeight: 100,
    resource: null,
    bids: [],
    reveals: [],
    ...overrides,
  };
}

function fakeHsd(names: OwnedName[] = [], detail?: NameDetails) {
  return {
    getNames: vi.fn(async () => names),
    getName: vi.fn(async (name: string) => detail ?? nameDetails({ name })),
  } as never;
}

interface FakeRenewalHsdOptions {
  names: OwnedName[];
  locked?: boolean;
  /** Names for which renewName() should reject with this hsd-style error message. */
  rejections?: Record<string, string>;
}

function fakeRenewalHsd(options: FakeRenewalHsdOptions) {
  return {
    getNames: vi.fn(async () => options.names),
    getWalletStatus: vi.fn(async () => ({
      connected: true,
      walletId: "primary",
      network: "regtest" as const,
      walletHeight: 100,
      locked: options.locked ?? false,
      rescanning: false,
    })),
    renewName: vi.fn(async (name: string) => {
      const rejection = options.rejections?.[name];
      if (rejection) throw new Error(rejection);
      return { txid: `txid-${name}`, fee: 1000n };
    }),
    lock: vi.fn(async () => {}),
  } as never;
}

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

describe("listNames", () => {
  it("returns hsd's names merged with local labels/memos", async () => {
    const hsd = fakeHsd([ownedName({ name: "example" })]);
    setNameMeta(db, "example", { label: "Blog", memo: "personal site" });

    const names = await listNames(db, hsd);
    expect(names).toHaveLength(1);
    expect(names[0]?.label).toBe("Blog");
    expect(names[0]?.memo).toBe("personal site");
  });

  it("leaves names without local metadata untouched", async () => {
    const hsd = fakeHsd([ownedName({ name: "example" })]);
    const names = await listNames(db, hsd);
    expect(names[0]?.label).toBeUndefined();
  });

  it("upserts a display cache row per name (spec §14.1)", async () => {
    const hsd = fakeHsd([ownedName({ name: "example", blocksRemaining: 42 })]);
    await listNames(db, hsd);

    const [cached] = db.select().from(nameCache).all();
    expect(cached?.name).toBe("example");
    expect(cached?.blocksRemaining).toBe(42);

    // A second fetch with a changed value should update, not duplicate, the row.
    const hsd2 = fakeHsd([ownedName({ name: "example", blocksRemaining: 10 })]);
    await listNames(db, hsd2);
    const rows = db.select().from(nameCache).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.blocksRemaining).toBe(10);
  });
});

describe("getNameDetail", () => {
  it("merges local metadata into the hsd-sourced detail", async () => {
    const hsd = fakeHsd([], nameDetails({ name: "example" }));
    setNameMeta(db, "example", { label: "Blog" });

    const detail = await getNameDetail(db, hsd, "example");
    expect(detail.label).toBe("Blog");
    expect(detail.ownerAddress).toBe("rs1qowner");
  });
});

describe("getNameResource", () => {
  it("returns hsd's decoded resource for the name", async () => {
    const resource = { records: [{ type: "TXT" as const, text: ["hi"] }], raw: "abcd", size: 2 };
    const hsd = fakeHsd([], nameDetails({ resource }));

    const result = await getNameResource(hsd, "example");
    expect(result).toEqual(resource);
  });

  it("is null when the name has no resource set", async () => {
    const hsd = fakeHsd([], nameDetails({ resource: null }));
    const result = await getNameResource(hsd, "example");
    expect(result).toBeNull();
  });
});

describe("renewNamesBatch", () => {
  it("renews every eligible name and reports success", async () => {
    const hsd = fakeRenewalHsd({
      names: [ownedName({ name: "a" }), ownedName({ name: "b" })],
    });

    const results = await renewNamesBatch(db, hsd, ["a", "b"]);
    expect(results).toEqual([
      { name: "a", status: "success", txid: "txid-a", reason: undefined },
      { name: "b", status: "success", txid: "txid-b", reason: undefined },
    ]);
  });

  it("skips a name that isn't currently renewable without calling hsd", async () => {
    const hsd = fakeRenewalHsd({
      names: [ownedName({ name: "auction-name", state: "bidding" })],
    });

    const results = await renewNamesBatch(db, hsd, ["auction-name"]);
    expect(results).toEqual([
      { name: "auction-name", status: "skipped", reason: "Renewal not available" },
    ]);
    expect((hsd as { renewName: ReturnType<typeof vi.fn> }).renewName).not.toHaveBeenCalled();
  });

  it("skips a name hsd's own list doesn't know about", async () => {
    const hsd = fakeRenewalHsd({ names: [] });
    const results = await renewNamesBatch(db, hsd, ["unknown"]);
    expect(results).toEqual([
      { name: "unknown", status: "skipped", reason: "Renewal not available" },
    ]);
  });

  it("reports a per-name hsd rejection as failed without stopping the batch", async () => {
    const hsd = fakeRenewalHsd({
      names: [ownedName({ name: "a" }), ownedName({ name: "b" })],
      rejections: { a: "Auction not found: a." },
    });

    const results = await renewNamesBatch(db, hsd, ["a", "b"]);
    expect(results[0]).toEqual({ name: "a", status: "failed", reason: "Auction not found: a." });
    expect(results[1]).toEqual({ name: "b", status: "success", txid: "txid-b", reason: undefined });
  });

  it("marks the locked name as failed and skips the rest of the batch once the wallet is locked", async () => {
    const hsd = fakeRenewalHsd({
      names: [ownedName({ name: "a" }), ownedName({ name: "b" }), ownedName({ name: "c" })],
      locked: true,
    });

    const results = await renewNamesBatch(db, hsd, ["a", "b", "c"]);
    expect(results).toEqual([
      { name: "a", status: "failed", reason: "Wallet locked" },
      { name: "b", status: "skipped", reason: "Wallet locked" },
      { name: "c", status: "skipped", reason: "Wallet locked" },
    ]);
    expect((hsd as { renewName: ReturnType<typeof vi.fn> }).renewName).not.toHaveBeenCalled();
  });

  it("locks the wallet once at the end of a successful batch, not per name", async () => {
    const hsd = fakeRenewalHsd({ names: [ownedName({ name: "a" }), ownedName({ name: "b" })] });
    await renewNamesBatch(db, hsd, ["a", "b"]);
    expect((hsd as { lock: ReturnType<typeof vi.fn> }).lock).toHaveBeenCalledTimes(1);
  });
});

describe("setNameMeta", () => {
  it("allows labeling a name not yet seen by listNames/getNameDetail", async () => {
    setNameMeta(db, "external", { label: "External" });
    setNameMeta(db, "external", { label: "Updated" });

    const hsd = fakeHsd([ownedName({ name: "external" })]);
    const names = await listNames(db, hsd);
    expect(names[0]?.label).toBe("Updated");
  });
});
