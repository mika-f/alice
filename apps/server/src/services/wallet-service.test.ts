import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import {
  getTransactions,
  issueReceiveAddress,
  listAddressHistory,
  send,
  setAddressLabel,
  setTxMeta,
} from "./wallet-service.js";

function fakeHsd(
  overrides: Partial<{ addresses: string[]; sendResult: { txid: string; fee: bigint } }> = {},
) {
  let addressCounter = 0;
  const addressQueue = overrides.addresses ?? [];
  return {
    getReceiveAddress: vi.fn(async () => {
      const address = addressQueue[addressCounter] ?? `rs1qfake${addressCounter}`;
      const index = addressCounter;
      addressCounter += 1;
      return { address, index, used: false };
    }),
    getTransactions: vi.fn(async () => ({
      items: [
        {
          txid: "abc123",
          kind: "receive" as const,
          amount: 100n,
          fee: 0n,
          timestamp: 1000,
          blockHeight: 1,
          confirmations: 5,
          status: "confirmed" as const,
          inputs: [],
          outputs: [{ address: "rs1qsomeone", value: 100n, covenant: "NONE" as const }],
        },
      ],
      nextCursor: null,
    })),
    send: vi.fn(async () => overrides.sendResult ?? { txid: "sent-txid", fee: 1400n }),
    lock: vi.fn(async () => {}),
  } as never;
}

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

describe("issueReceiveAddress", () => {
  it("records every issued address for later history lookups", async () => {
    const hsd = fakeHsd({ addresses: ["rs1qone", "rs1qtwo"] });
    await issueReceiveAddress(db, hsd);
    await issueReceiveAddress(db, hsd);

    const history = await listAddressHistory(db, hsd);
    expect(history.map((entry) => entry.address).sort()).toEqual(["rs1qone", "rs1qtwo"]);
  });
});

describe("setAddressLabel / listAddressHistory", () => {
  it("attaches a label to a previously issued address", async () => {
    const hsd = fakeHsd({ addresses: ["rs1qone"] });
    await issueReceiveAddress(db, hsd);
    setAddressLabel(db, "rs1qone", "Donations");

    const history = await listAddressHistory(db, hsd);
    expect(history[0]?.label).toBe("Donations");
  });

  it("marks an address as used when it appears in recent transaction outputs", async () => {
    const hsd = fakeHsd({ addresses: ["rs1qsomeone"] });
    await issueReceiveAddress(db, hsd);

    const history = await listAddressHistory(db, hsd);
    expect(history[0]?.used).toBe(true);
  });

  it("allows labeling an address never issued through this app", () => {
    setAddressLabel(db, "rs1qexternal", "External");
    setAddressLabel(db, "rs1qexternal", "Updated");
    // no throw; verified indirectly via a fresh label overwrite not erroring
    expect(true).toBe(true);
  });
});

describe("send (idempotency)", () => {
  it("broadcasts once and returns the same result for a repeated idempotency key", async () => {
    const hsd = fakeHsd({ sendResult: { txid: "txid-1", fee: 1400n } });
    const request = {
      address: "rs1qdest",
      amount: 100_000_000n,
      idempotencyKey: "key-1",
    };

    const first = await send(db, hsd, request);
    const second = await send(db, hsd, request);

    expect(first).toEqual({ txid: "txid-1", fee: 1400n });
    expect(second).toEqual({ txid: "txid-1", fee: 1400n });
    expect((hsd as { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalledTimes(1);
  });

  it("locks the wallet after a successful send", async () => {
    const hsd = fakeHsd();
    await send(db, hsd, { address: "rs1qdest", amount: 1n, idempotencyKey: "key-2" });
    expect((hsd as { lock: ReturnType<typeof vi.fn> }).lock).toHaveBeenCalledTimes(1);
  });

  it("stores the label/memo for a new send, visible via tx_meta lookup", async () => {
    const hsd = fakeHsd({ sendResult: { txid: "abc123", fee: 100n } });
    await send(db, hsd, {
      address: "rs1qdest",
      amount: 1n,
      idempotencyKey: "key-3",
      label: "Rent",
      memo: "July",
    });

    const page = await getTransactions(db, hsd, { limit: 10 });
    expect(page.items[0]?.label).toBe("Rent");
    expect(page.items[0]?.memo).toBe("July");
  });
});

describe("getTransactions / setTxMeta", () => {
  it("merges locally stored labels and memos into hsd's transaction history", async () => {
    const hsd = fakeHsd();
    setTxMeta(db, "abc123", { label: "Salary", memo: "June" });

    const page = await getTransactions(db, hsd, { limit: 10 });
    expect(page.items[0]?.label).toBe("Salary");
    expect(page.items[0]?.memo).toBe("June");
  });

  it("leaves transactions without local metadata untouched", async () => {
    const hsd = fakeHsd();
    const page = await getTransactions(db, hsd, { limit: 10 });
    expect(page.items[0]?.label).toBeUndefined();
  });
});
