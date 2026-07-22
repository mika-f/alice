import { describe, expect, it } from "vitest";
import {
  renewNamesBatchRequestSchema,
  revokeNameRequestSchema,
  transferNameRequestSchema,
  updateNameRequestSchema,
} from "./name.js";

describe("updateNameRequestSchema", () => {
  it("accepts a well-formed record list", () => {
    const result = updateNameRequestSchema.parse({
      records: [
        { type: "NS", ns: "ns1.example.com." },
        { type: "TXT", text: ["hello"] },
      ],
    });
    expect(result.records).toHaveLength(2);
  });

  it("rejects a record with an unrecognized type", () => {
    expect(() => updateNameRequestSchema.parse({ records: [{ type: "MX", ns: "x." }] })).toThrow();
  });

  it("rejects a DS record with an out-of-range key tag", () => {
    expect(() =>
      updateNameRequestSchema.parse({
        records: [{ type: "DS", keyTag: 999999, algorithm: 8, digestType: 2, digest: "aabb" }],
      }),
    ).toThrow();
  });
});

describe("renewNamesBatchRequestSchema", () => {
  it("accepts a non-empty name list", () => {
    expect(renewNamesBatchRequestSchema.parse({ names: ["example"] }).names).toEqual(["example"]);
  });

  it("rejects an empty name list", () => {
    expect(() => renewNamesBatchRequestSchema.parse({ names: [] })).toThrow();
  });
});

describe("transferNameRequestSchema", () => {
  it("requires a non-empty address", () => {
    expect(() => transferNameRequestSchema.parse({ address: "" })).toThrow();
    expect(transferNameRequestSchema.parse({ address: "rs1qdest" }).address).toBe("rs1qdest");
  });
});

describe("revokeNameRequestSchema", () => {
  it("requires both a password and a code", () => {
    expect(() => revokeNameRequestSchema.parse({ password: "hunter2" })).toThrow();
    expect(() => revokeNameRequestSchema.parse({ code: "123456" })).toThrow();
    expect(revokeNameRequestSchema.parse({ password: "hunter2", code: "123456" })).toEqual({
      password: "hunter2",
      code: "123456",
    });
  });
});
