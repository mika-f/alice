import { describe, expect, it } from "vitest";
import type { DnsRecord } from "./resource.js";
import {
  isDeletingAllRecords,
  isRemovingLastNsRecord,
  isValidDsDigestHex,
  isValidHostname,
  isValidIpv4,
  isValidIpv6,
  validateResource,
} from "./resource-validation.js";

describe("isValidHostname", () => {
  it("accepts a well-formed FQDN with a trailing dot", () => {
    expect(isValidHostname("ns1.example.com.")).toBe(true);
  });

  it("rejects a hostname missing the trailing dot", () => {
    expect(isValidHostname("ns1.example.com")).toBe(false);
  });

  it("rejects a label starting or ending with a hyphen", () => {
    expect(isValidHostname("-ns1.example.com.")).toBe(false);
    expect(isValidHostname("ns1-.example.com.")).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(isValidHostname(".")).toBe(false);
  });
});

describe("isValidIpv4", () => {
  it("accepts a valid address", () => {
    expect(isValidIpv4("1.2.3.4")).toBe(true);
  });

  it("rejects an octet above 255", () => {
    expect(isValidIpv4("1.2.3.256")).toBe(false);
  });

  it("rejects a leading-zero octet (ambiguous octal in some parsers)", () => {
    expect(isValidIpv4("1.2.3.010")).toBe(false);
  });

  it("rejects an IPv6 address", () => {
    expect(isValidIpv4("::1")).toBe(false);
  });
});

describe("isValidIpv6", () => {
  it("accepts a full address", () => {
    expect(isValidIpv6("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(true);
  });

  it("accepts the compressed loopback", () => {
    expect(isValidIpv6("::1")).toBe(true);
  });

  it("rejects an IPv4 address", () => {
    expect(isValidIpv6("1.2.3.4")).toBe(false);
  });
});

describe("isValidDsDigestHex", () => {
  it("accepts an even-length hex string", () => {
    expect(isValidDsDigestHex("aabbcc")).toBe(true);
  });

  it("rejects an odd-length string", () => {
    expect(isValidDsDigestHex("abc")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidDsDigestHex("zzzz")).toBe(false);
  });

  it("rejects more than 255 bytes", () => {
    expect(isValidDsDigestHex("aa".repeat(256))).toBe(false);
  });
});

describe("validateResource", () => {
  it("is clean for a well-formed set of records", () => {
    const records: DnsRecord[] = [
      { type: "NS", ns: "ns1.example.com." },
      { type: "GLUE4", ns: "ns1.example.com.", address: "1.2.3.4" },
      { type: "TXT", text: ["hello"] },
    ];
    expect(validateResource(records)).toEqual([]);
  });

  it("flags an invalid NS hostname", () => {
    const issues = validateResource([{ type: "NS", ns: "not a hostname" }]);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "ns-hostname-invalid", index: 0 }),
    );
  });

  it("flags a GLUE record with no matching NS record", () => {
    const issues = validateResource([
      { type: "GLUE4", ns: "ns1.example.com.", address: "1.2.3.4" },
    ]);
    expect(issues).toContainEqual(expect.objectContaining({ code: "glue-without-ns", index: 0 }));
  });

  it("flags duplicate records", () => {
    const issues = validateResource([
      { type: "TXT", text: ["hi"] },
      { type: "TXT", text: ["hi"] },
    ]);
    expect(issues).toContainEqual(expect.objectContaining({ code: "duplicate-record", index: 1 }));
  });

  it("flags an oversized TXT string", () => {
    const issues = validateResource([{ type: "TXT", text: ["a".repeat(256)] }]);
    expect(issues).toContainEqual(expect.objectContaining({ code: "txt-too-large", index: 0 }));
  });

  it("does not attempt to validate an UNKNOWN record", () => {
    const issues = validateResource([{ type: "UNKNOWN", raw: "{}" }]);
    expect(issues).toEqual([]);
  });
});

describe("isDeletingAllRecords", () => {
  it("is true when going from some records to none", () => {
    expect(isDeletingAllRecords([{ type: "TXT", text: ["hi"] }], [])).toBe(true);
  });

  it("is false when there were never any records", () => {
    expect(isDeletingAllRecords([], [])).toBe(false);
  });
});

describe("isRemovingLastNsRecord", () => {
  it("is true when the only NS record is removed", () => {
    const before: DnsRecord[] = [
      { type: "NS", ns: "ns1.example.com." },
      { type: "TXT", text: ["hi"] },
    ];
    const after: DnsRecord[] = [{ type: "TXT", text: ["hi"] }];
    expect(isRemovingLastNsRecord(before, after)).toBe(true);
  });

  it("is false when another NS record remains", () => {
    const before: DnsRecord[] = [
      { type: "NS", ns: "ns1.example.com." },
      { type: "NS", ns: "ns2.example.com." },
    ];
    const after: DnsRecord[] = [{ type: "NS", ns: "ns2.example.com." }];
    expect(isRemovingLastNsRecord(before, after)).toBe(false);
  });
});
