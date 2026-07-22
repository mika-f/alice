import { describe, expect, it } from "vitest";
import type { RawTx } from "./raw-schemas.js";
import { toTransactionRecord } from "./transaction-mapper.js";

const OURS = { name: "default", account: 0 };

function baseTx(overrides: Partial<RawTx>): RawTx {
  return {
    hash: "deadbeef",
    height: -1,
    time: 0,
    fee: 0,
    rate: 0,
    confirmations: 0,
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

describe("toTransactionRecord", () => {
  it("classifies a coinbase/incoming tx as receive with the incoming amount", () => {
    const raw = baseTx({
      height: 1,
      time: 1_700_000_000,
      confirmations: 10,
      inputs: [{ value: 0, address: null, path: null }],
      outputs: [
        {
          value: 2_000_000_000,
          address: "rs1qaddr",
          covenant: { type: 0, action: "NONE", items: [] },
          path: OURS,
        },
      ],
    });

    const record = toTransactionRecord(raw);
    expect(record.kind).toBe("receive");
    expect(record.amount).toBe(2_000_000_000n);
    expect(record.status).toBe("confirmed");
    expect(record.blockHeight).toBe(1);
    expect(record.timestamp).toBe(1_700_000_000_000);
  });

  it("classifies an outgoing tx as send with the external amount only (excludes change)", () => {
    const raw = baseTx({
      fee: 1400,
      inputs: [{ value: 2_000_000_000, address: "rs1qours", path: OURS }],
      outputs: [
        {
          value: 100_000_000,
          address: "rs1qtheirs",
          covenant: { type: 0, action: "NONE", items: [] },
          path: null,
        },
        {
          value: 1_899_998_600,
          address: "rs1qchange",
          covenant: { type: 0, action: "NONE", items: [] },
          path: OURS,
        },
      ],
    });

    const record = toTransactionRecord(raw);
    expect(record.kind).toBe("send");
    expect(record.amount).toBe(100_000_000n);
    expect(record.fee).toBe(1400n);
    expect(record.status).toBe("pending");
    expect(record.blockHeight).toBeNull();
  });

  it("classifies a covenant output as a name-operation regardless of direction", () => {
    const raw = baseTx({
      confirmations: 1,
      height: 5,
      inputs: [{ value: 1_000_000, address: "rs1qours", path: OURS }],
      outputs: [
        {
          value: 0,
          address: "rs1qours",
          covenant: { type: 6, action: "RENEW", items: ["abcd"] },
          path: OURS,
        },
      ],
    });

    const record = toTransactionRecord(raw);
    expect(record.kind).toBe("name-operation");
    expect(record.outputs[0]?.covenant).toBe("RENEW");
  });

  it("falls back to NONE for a covenant action hsd hasn't taught us yet", () => {
    const raw = baseTx({
      outputs: [
        {
          value: 0,
          address: null,
          covenant: { type: 99, action: "SOME_FUTURE_TYPE", items: [] },
          path: null,
        },
      ],
    });

    const record = toTransactionRecord(raw);
    expect(record.outputs[0]?.covenant).toBe("NONE");
  });
});
