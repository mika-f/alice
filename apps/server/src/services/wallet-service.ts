import type {
  BroadcastResult,
  MnemonicImportInput,
  ReceiveAddress,
  SendRequest,
  TransactionPage,
  TransactionQuery,
  WalletBalance,
  WalletStatus,
} from "@alice-hns-wallet/domain";
import type { HsdV8Adapter } from "@alice-hns-wallet/hsd-client";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { addresses, sendIdempotency, txMeta } from "../db/schema.js";

export function getBalance(hsd: HsdV8Adapter): Promise<WalletBalance> {
  return hsd.getBalance();
}

export function getWalletStatus(hsd: HsdV8Adapter): Promise<WalletStatus> {
  return hsd.getWalletStatus();
}

export interface AddressHistoryEntry {
  address: string;
  index: number;
  label: string | null;
  used: boolean;
  createdAt: Date;
}

export async function issueReceiveAddress(db: Db, hsd: HsdV8Adapter): Promise<ReceiveAddress> {
  const issued = await hsd.getReceiveAddress();

  db.insert(addresses)
    .values({ address: issued.address, addressIndex: issued.index })
    .onConflictDoNothing()
    .run();

  return issued;
}

/**
 * "Used" is approximated by checking a recent window of confirmed history for a
 * matching output address — hsd's HTTP API has no direct "is this address used" flag.
 */
export async function listAddressHistory(
  db: Db,
  hsd: HsdV8Adapter,
): Promise<AddressHistoryEntry[]> {
  const rows = db.select().from(addresses).all();
  const recent = await hsd.getTransactions({ limit: 100 });
  const usedAddresses = new Set(
    recent.items.flatMap((tx) => tx.outputs.map((output) => output.address).filter(Boolean)),
  );

  return rows
    .map((row) => ({
      address: row.address,
      index: row.addressIndex,
      label: row.label,
      used: usedAddresses.has(row.address),
      createdAt: row.createdAt,
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function setAddressLabel(db: Db, address: string, label: string | null): void {
  const [existing] = db.select().from(addresses).where(eq(addresses.address, address)).all();
  if (existing) {
    db.update(addresses).set({ label }).where(eq(addresses.address, address)).run();
  } else {
    db.insert(addresses).values({ address, addressIndex: -1, label }).run();
  }
}

export function previewSend(hsd: HsdV8Adapter, request: SendRequest): Promise<BroadcastResult> {
  return hsd.previewSend(request);
}

/** Spec §12.4: replaying the same idempotency key returns the original result instead of double-sending. */
export async function send(
  db: Db,
  hsd: HsdV8Adapter,
  request: SendRequest & { label?: string; memo?: string },
): Promise<BroadcastResult> {
  const [existing] = db
    .select()
    .from(sendIdempotency)
    .where(eq(sendIdempotency.idempotencyKey, request.idempotencyKey))
    .all();
  if (existing) {
    return { txid: existing.txid, fee: BigInt(existing.fee) };
  }

  const result = await hsd.send(request);

  db.insert(sendIdempotency)
    .values({
      idempotencyKey: request.idempotencyKey,
      txid: result.txid,
      fee: result.fee.toString(),
    })
    .run();

  if (request.label || request.memo) {
    setTxMeta(db, result.txid, { label: request.label, memo: request.memo });
  }

  // Spec §9.5: minimize how long the wallet stays unlocked; harmless no-op if there's no passphrase.
  await hsd.lock();

  return result;
}

export interface TxMetaInput {
  label?: string;
  memo?: string;
}

export function setTxMeta(db: Db, txid: string, input: TxMetaInput): void {
  const [existing] = db.select().from(txMeta).where(eq(txMeta.txid, txid)).all();
  if (existing) {
    db.update(txMeta)
      .set({ label: input.label, memo: input.memo })
      .where(eq(txMeta.txid, txid))
      .run();
  } else {
    db.insert(txMeta).values({ txid, label: input.label, memo: input.memo }).run();
  }
}

export async function getTransactions(
  db: Db,
  hsd: HsdV8Adapter,
  query: TransactionQuery,
): Promise<TransactionPage> {
  const page = await hsd.getTransactions(query);
  const metaRows = db.select().from(txMeta).all();
  const metaByTxid = new Map(metaRows.map((row) => [row.txid, row]));

  return {
    ...page,
    items: page.items.map((item) => {
      const meta = metaByTxid.get(item.txid);
      return meta
        ? { ...item, label: meta.label ?? undefined, memo: meta.memo ?? undefined }
        : item;
    }),
  };
}

export function lockWallet(hsd: HsdV8Adapter): Promise<void> {
  return hsd.lock();
}

export function unlockWallet(
  hsd: HsdV8Adapter,
  passphrase: string,
  timeoutSeconds: number,
): Promise<void> {
  return hsd.unlock(passphrase, timeoutSeconds);
}

export async function importMnemonic(hsd: HsdV8Adapter, input: MnemonicImportInput): Promise<void> {
  await hsd.createWalletFromMnemonic(input);
  await hsd.rescan(0);
}
