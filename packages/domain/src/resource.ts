export interface NsRecord {
  type: "NS";
  ns: string;
}

export interface Glue4Record {
  type: "GLUE4";
  ns: string;
  address: string;
}

export interface Glue6Record {
  type: "GLUE6";
  ns: string;
  address: string;
}

export interface DsRecord {
  type: "DS";
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: string;
}

export interface TxtRecord {
  type: "TXT";
  text: string[];
}

export interface Synth4Record {
  type: "SYNTH4";
  address: string;
}

export interface Synth6Record {
  type: "SYNTH6";
  address: string;
}

export interface UnknownRecord {
  type: "UNKNOWN";
  raw: string;
}

export type DnsRecord =
  | NsRecord
  | Glue4Record
  | Glue6Record
  | DsRecord
  | TxtRecord
  | Synth4Record
  | Synth6Record
  | UnknownRecord;

export interface NameResource {
  records: DnsRecord[];
  raw: string;
  size: number;
}
