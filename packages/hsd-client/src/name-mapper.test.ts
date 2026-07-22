import { describe, expect, it } from "vitest";
import {
  hasOwner,
  toNameDetails,
  toNameResource,
  toNameState,
  toOwnedName,
  toTransferState,
} from "./name-mapper.js";
import type { RawAuction, RawName, RawNameOwner, RawNameResource } from "./raw-schemas.js";

const NO_OWNER: RawNameOwner = {
  hash: "0000000000000000000000000000000000000000000000000000000000000000",
  index: 0xffffffff,
};

const AN_OWNER: RawNameOwner = {
  hash: "111c212f4967799f2cd1952f76dab9d3d975557252d45271d25a5a27c60ecb40",
  index: 0,
};

function baseName(overrides: Partial<RawName>): RawName {
  return {
    name: "example",
    nameHash: "abcd",
    state: "BIDDING",
    height: 100,
    renewal: 0,
    owner: NO_OWNER,
    value: 0,
    highest: 0,
    data: "",
    transfer: 0,
    revoked: 0,
    claimed: 0,
    renewals: 0,
    registered: false,
    expired: false,
    weak: false,
    stats: null,
    ...overrides,
  };
}

describe("toNameState", () => {
  it("maps auction phases directly", () => {
    expect(toNameState(baseName({ state: "OPENING" }))).toBe("opening");
    expect(toNameState(baseName({ state: "BIDDING" }))).toBe("bidding");
    expect(toNameState(baseName({ state: "REVEAL" }))).toBe("revealing");
  });

  it("maps CLOSED to owned when registered, closed (available) otherwise", () => {
    expect(toNameState(baseName({ state: "CLOSED", registered: true, owner: AN_OWNER }))).toBe(
      "owned",
    );
    expect(toNameState(baseName({ state: "CLOSED", registered: false }))).toBe("closed");
  });

  it("prioritizes revoked over the underlying auction phase", () => {
    expect(toNameState(baseName({ state: "REVOKED", registered: true }))).toBe("revoked");
  });

  it("reports transferring once a transfer height is set, even while CLOSED", () => {
    expect(
      toNameState(baseName({ state: "CLOSED", registered: true, transfer: 213, owner: AN_OWNER })),
    ).toBe("transferring");
  });

  it("prioritizes expired over every other signal", () => {
    expect(toNameState(baseName({ state: "REVOKED", expired: true }))).toBe("expired");
    expect(toNameState(baseName({ state: "CLOSED", registered: true, expired: true }))).toBe(
      "expired",
    );
  });
});

describe("toTransferState", () => {
  it("is none when no transfer is pending", () => {
    expect(toTransferState(baseName({ transfer: 0 }))).toBe("none");
  });

  it("is pending while blocksUntilValidFinalize is still positive", () => {
    expect(
      toTransferState(baseName({ transfer: 213, stats: { blocksUntilValidFinalize: 9 } })),
    ).toBe("pending");
  });

  it("is finalizable once blocksUntilValidFinalize reaches zero or goes negative", () => {
    expect(
      toTransferState(baseName({ transfer: 213, stats: { blocksUntilValidFinalize: -1 } })),
    ).toBe("finalizable");
  });

  it("defaults to pending (not finalizable) when stats are missing entirely", () => {
    expect(toTransferState(baseName({ transfer: 213, stats: null }))).toBe("pending");
  });
});

describe("hasOwner", () => {
  it("treats hsd's 0xffffffff sentinel as no owner", () => {
    expect(hasOwner(NO_OWNER)).toBe(false);
    expect(hasOwner(AN_OWNER)).toBe(true);
  });
});

describe("toOwnedName", () => {
  it("picks the most relevant blocksUntil* stat as blocksRemaining", () => {
    const owned = toOwnedName(
      baseName({
        state: "BIDDING",
        stats: { bidPeriodStart: 10, bidPeriodEnd: 15, blocksUntilReveal: 4 },
      }),
    );
    expect(owned.blocksRemaining).toBe(4);
  });

  it("summarizes the resource as a byte count without decoding it", () => {
    const owned = toOwnedName(baseName({ data: "0001036e73" }));
    expect(owned.resourceSummary).toBe("5 bytes");
  });

  it("is null when there is no resource set", () => {
    const owned = toOwnedName(baseName({ data: "" }));
    expect(owned.resourceSummary).toBeNull();
  });
});

describe("toNameResource", () => {
  const decoded: RawNameResource = {
    records: [
      { type: "NS", ns: "ns1.example.com." },
      { type: "GLUE4", ns: "ns1.example.com.", address: "1.2.3.4" },
      { type: "TXT", txt: ["hello", "world"] },
      { type: "DS", keyTag: 12345, algorithm: 8, digestType: 2, digest: "aabb" },
      { type: "TLS", something: "unrecognized" },
    ],
  };

  it("decodes known record types and falls back to UNKNOWN for the rest", () => {
    const resource = toNameResource(decoded, "0001036e7331");
    expect(resource?.records).toEqual([
      { type: "NS", ns: "ns1.example.com." },
      { type: "GLUE4", ns: "ns1.example.com.", address: "1.2.3.4" },
      { type: "TXT", text: ["hello", "world"] },
      { type: "DS", keyTag: 12345, algorithm: 8, digestType: 2, digest: "aabb" },
      { type: "UNKNOWN", raw: JSON.stringify({ type: "TLS", something: "unrecognized" }) },
    ]);
    expect(resource?.raw).toBe("0001036e7331");
    expect(resource?.size).toBe(6);
  });

  it("is null when there is no data even if hsd somehow returned decoded records", () => {
    expect(toNameResource(decoded, "")).toBeNull();
  });

  it("is null when hsd has no resource for the name", () => {
    expect(toNameResource(null, "")).toBeNull();
  });
});

describe("toNameDetails", () => {
  function baseAuction(overrides: Partial<RawAuction>): RawAuction {
    return { ...baseName({}), bids: [], reveals: [], ...overrides };
  }

  it("uses the ownership lookup result rather than the raw registered flag", () => {
    const details = toNameDetails(
      baseAuction({ state: "CLOSED", registered: true, owner: AN_OWNER }),
      null,
      { owned: false, ownerAddress: null },
    );
    expect(details.owned).toBe(false);
    expect(details.ownerAddress).toBeNull();
  });

  it("maps bids and reveals to bigint amounts", () => {
    const details = toNameDetails(
      baseAuction({
        state: "REVEAL",
        bids: [
          {
            prevout: { hash: "h", index: 0 },
            value: 700_000,
            lockup: 900_000,
            height: 5,
            own: true,
          },
        ],
        reveals: [],
      }),
      null,
      { owned: false, ownerAddress: null },
    );
    expect(details.bids).toEqual([{ value: 700_000n, lockup: 900_000n, height: 5, own: true }]);
  });

  it("maps another bidder's still-blinded bid to a null value", () => {
    const details = toNameDetails(
      baseAuction({
        state: "REVEAL",
        bids: [{ prevout: { hash: "h", index: 0 }, lockup: 2_100_000, height: 5, own: false }],
        reveals: [],
      }),
      null,
      { owned: false, ownerAddress: null },
    );
    expect(details.bids).toEqual([{ value: null, lockup: 2_100_000n, height: 5, own: false }]);
  });
});
