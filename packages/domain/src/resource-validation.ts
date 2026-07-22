import type { DnsRecord } from "./resource.js";

/**
 * hsd's real wire-format encoding/size limit is authoritative and enforced server-side (see
 * HsdV8Adapter.previewUpdateName) — this file only catches obviously-invalid input early for UX,
 * mirroring the project's existing "decode via hsd, don't reimplement" stance (docs/02 §9).
 */
export const MAX_RESOURCE_SIZE = 512;
const MAX_TXT_STRING_BYTES = 255;
const MAX_DS_DIGEST_BYTES = 255;

export type ResourceValidationCode =
  | "ns-hostname-invalid"
  | "glue-hostname-invalid"
  | "ipv4-invalid"
  | "ipv6-invalid"
  | "ds-key-tag-invalid"
  | "ds-algorithm-invalid"
  | "ds-digest-type-invalid"
  | "ds-digest-invalid"
  | "txt-too-large"
  | "duplicate-record"
  | "glue-without-ns";

export interface ResourceValidationIssue {
  code: ResourceValidationCode;
  /** Index into the records array this issue applies to; -1 for a resource-wide issue. */
  index: number;
  message: string;
}

const HOSTNAME_LABEL = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

/** hsd requires DNS names in presentation format with a trailing dot (bns's isFQDN/isName). */
export function isValidHostname(value: string): boolean {
  if (!value.endsWith(".")) return false;
  const withoutTrailingDot = value.slice(0, -1);
  if (withoutTrailingDot.length === 0 || withoutTrailingDot.length > 253) return false;
  return withoutTrailingDot.split(".").every((label) => HOSTNAME_LABEL.test(label));
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidIpv4(value: string): boolean {
  const match = IPV4_RE.exec(value);
  if (!match) return false;
  return match
    .slice(1)
    .every((part) => part.length <= 3 && Number(part) <= 255 && String(Number(part)) === part);
}

// Standard comprehensive IPv6 literal matcher (covers ::, embedded IPv4 tails, zone IDs).
const IPV6_RE =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/;

export function isValidIpv6(value: string): boolean {
  return IPV6_RE.test(value);
}

export function isValidDsKeyTag(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 0xffff;
}

export function isValidDsAlgorithm(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 0xff;
}

export function isValidDsDigestType(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 0xff;
}

export function isValidDsDigestHex(hex: string): boolean {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return false;
  return hex.length / 2 <= MAX_DS_DIGEST_BYTES;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function duplicateKey(record: DnsRecord): string {
  return JSON.stringify(record);
}

/** Spec §16.3: per-record field validation, duplicate detection, and NS/GLUE consistency. */
export function validateResource(records: DnsRecord[]): ResourceValidationIssue[] {
  const issues: ResourceValidationIssue[] = [];

  records.forEach((record, index) => {
    switch (record.type) {
      case "NS":
        if (!isValidHostname(record.ns)) {
          issues.push({
            code: "ns-hostname-invalid",
            index,
            message: `Invalid NS hostname: ${record.ns}`,
          });
        }
        break;
      case "GLUE4":
        if (!isValidHostname(record.ns)) {
          issues.push({
            code: "glue-hostname-invalid",
            index,
            message: `Invalid GLUE hostname: ${record.ns}`,
          });
        }
        if (!isValidIpv4(record.address)) {
          issues.push({
            code: "ipv4-invalid",
            index,
            message: `Invalid IPv4 address: ${record.address}`,
          });
        }
        break;
      case "GLUE6":
        if (!isValidHostname(record.ns)) {
          issues.push({
            code: "glue-hostname-invalid",
            index,
            message: `Invalid GLUE hostname: ${record.ns}`,
          });
        }
        if (!isValidIpv6(record.address)) {
          issues.push({
            code: "ipv6-invalid",
            index,
            message: `Invalid IPv6 address: ${record.address}`,
          });
        }
        break;
      case "SYNTH4":
        if (!isValidIpv4(record.address)) {
          issues.push({
            code: "ipv4-invalid",
            index,
            message: `Invalid IPv4 address: ${record.address}`,
          });
        }
        break;
      case "SYNTH6":
        if (!isValidIpv6(record.address)) {
          issues.push({
            code: "ipv6-invalid",
            index,
            message: `Invalid IPv6 address: ${record.address}`,
          });
        }
        break;
      case "DS":
        if (!isValidDsKeyTag(record.keyTag)) {
          issues.push({ code: "ds-key-tag-invalid", index, message: "DS key tag must be 0-65535" });
        }
        if (!isValidDsAlgorithm(record.algorithm)) {
          issues.push({
            code: "ds-algorithm-invalid",
            index,
            message: "DS algorithm must be 0-255",
          });
        }
        if (!isValidDsDigestType(record.digestType)) {
          issues.push({
            code: "ds-digest-type-invalid",
            index,
            message: "DS digest type must be 0-255",
          });
        }
        if (!isValidDsDigestHex(record.digest)) {
          issues.push({
            code: "ds-digest-invalid",
            index,
            message: "DS digest must be an even-length hex string of at most 255 bytes",
          });
        }
        break;
      case "TXT":
        record.text.forEach((str, stringIndex) => {
          if (utf8ByteLength(str) > MAX_TXT_STRING_BYTES) {
            issues.push({
              code: "txt-too-large",
              index,
              message: `TXT string #${stringIndex + 1} exceeds ${MAX_TXT_STRING_BYTES} bytes`,
            });
          }
        });
        break;
      case "UNKNOWN":
        // Not decodable, so not independently validatable — passed through as-is.
        break;
    }
  });

  const seen = new Set<string>();
  records.forEach((record, index) => {
    const key = duplicateKey(record);
    if (seen.has(key)) {
      issues.push({ code: "duplicate-record", index, message: "Duplicate record" });
    }
    seen.add(key);
  });

  const nsHostnames = new Set(
    records
      .filter((r): r is Extract<DnsRecord, { type: "NS" }> => r.type === "NS")
      .map((r) => r.ns),
  );
  records.forEach((record, index) => {
    if ((record.type === "GLUE4" || record.type === "GLUE6") && !nsHostnames.has(record.ns)) {
      issues.push({
        code: "glue-without-ns",
        index,
        message: `GLUE record for ${record.ns} has no matching NS record`,
      });
    }
  });

  return issues;
}

/** Spec §16.4: warn before a change that removes every record. */
export function isDeletingAllRecords(before: DnsRecord[], after: DnsRecord[]): boolean {
  return before.length > 0 && after.length === 0;
}

/** Spec §16.4: warn before a change that removes the last remaining NS record. */
export function isRemovingLastNsRecord(before: DnsRecord[], after: DnsRecord[]): boolean {
  const beforeHasNs = before.some((r) => r.type === "NS");
  const afterHasNs = after.some((r) => r.type === "NS");
  return beforeHasNs && !afterHasNs;
}
