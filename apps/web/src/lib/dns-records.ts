import type { DnsRecordResponse } from "../api/names.js";

export const RECORD_TYPES = ["NS", "GLUE4", "GLUE6", "DS", "TXT", "SYNTH4", "SYNTH6"] as const;

export type EditableRecordType = (typeof RECORD_TYPES)[number];

export function blankRecord(type: EditableRecordType): DnsRecordResponse {
  switch (type) {
    case "NS":
      return { type: "NS", ns: "" };
    case "GLUE4":
      return { type: "GLUE4", ns: "", address: "" };
    case "GLUE6":
      return { type: "GLUE6", ns: "", address: "" };
    case "DS":
      return { type: "DS", keyTag: 0, algorithm: 0, digestType: 0, digest: "" };
    case "TXT":
      return { type: "TXT", text: [""] };
    case "SYNTH4":
      return { type: "SYNTH4", address: "" };
    case "SYNTH6":
      return { type: "SYNTH6", address: "" };
  }
}

export function describeRecord(record: DnsRecordResponse): string {
  switch (record.type) {
    case "NS":
      return `NS ${record.ns}`;
    case "GLUE4":
      return `GLUE4 ${record.ns} → ${record.address}`;
    case "GLUE6":
      return `GLUE6 ${record.ns} → ${record.address}`;
    case "DS":
      return `DS keyTag=${record.keyTag} alg=${record.algorithm} digestType=${record.digestType} digest=${record.digest}`;
    case "TXT":
      return `TXT ${record.text.join(" ")}`;
    case "SYNTH4":
      return `SYNTH4 ${record.address}`;
    case "SYNTH6":
      return `SYNTH6 ${record.address}`;
    case "UNKNOWN":
      return `Unrecognized record: ${record.raw}`;
  }
}
