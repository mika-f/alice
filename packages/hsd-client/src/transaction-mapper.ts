import type {
  CovenantType,
  TransactionKind,
  TransactionRecord,
  TransactionStatus,
} from "@alice-hns-wallet/domain";
import { COVENANT_TYPES } from "@alice-hns-wallet/domain";
import type { RawTx } from "./raw-schemas.js";

function toCovenantType(action: string): CovenantType {
  return (COVENANT_TYPES as readonly string[]).includes(action) ? (action as CovenantType) : "NONE";
}

function classifyKind(raw: RawTx): TransactionKind {
  if (raw.outputs.some((output) => output.covenant.action !== "NONE")) {
    return "name-operation";
  }
  return raw.inputs.some((input) => input.path !== null) ? "send" : "receive";
}

function classifyStatus(raw: RawTx): TransactionStatus {
  if (raw.confirmations > 0) return "confirmed";
  if (raw.height === -1) return "pending";
  return "unknown";
}

/**
 * hsd's history/send/create responses don't identify "our" addresses directly;
 * an input with a non-null `path` is one our wallet controls (i.e. we spent it).
 * Net amount is computed from that, excluding our own change output on sends.
 */
export function toTransactionRecord(raw: RawTx): TransactionRecord {
  const kind = classifyKind(raw);

  let amount = 0n;
  if (kind === "receive") {
    amount = raw.outputs
      .filter((output) => output.path !== null)
      .reduce((sum, output) => sum + BigInt(output.value), 0n);
  } else if (kind === "send") {
    amount = raw.outputs
      .filter((output) => output.path === null)
      .reduce((sum, output) => sum + BigInt(output.value), 0n);
  }

  return {
    txid: raw.hash,
    kind,
    amount,
    fee: BigInt(Math.max(raw.fee, 0)),
    timestamp: raw.time > 0 ? raw.time * 1000 : null,
    blockHeight: raw.height >= 0 ? raw.height : null,
    confirmations: raw.confirmations,
    status: classifyStatus(raw),
    inputs: raw.inputs.map((input) => ({
      txid: "",
      index: 0,
      address: input.address ?? undefined,
      value: input.value !== null ? BigInt(input.value) : undefined,
    })),
    outputs: raw.outputs.map((output) => ({
      address: output.address ?? undefined,
      value: BigInt(output.value),
      covenant: toCovenantType(output.covenant.action),
    })),
  };
}
