import type { NameDetails, OwnedName } from "@alice-hns-wallet/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { nameCache } from "../db/schema.js";
import { getNameDetail, getNameResource, listNames, setNameMeta } from "./name-service.js";

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

describe("setNameMeta", () => {
  it("allows labeling a name not yet seen by listNames/getNameDetail", async () => {
    setNameMeta(db, "external", { label: "External" });
    setNameMeta(db, "external", { label: "Updated" });

    const hsd = fakeHsd([ownedName({ name: "external" })]);
    const names = await listNames(db, hsd);
    expect(names[0]?.label).toBe("Updated");
  });
});
