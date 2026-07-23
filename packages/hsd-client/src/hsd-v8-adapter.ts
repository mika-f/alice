import {
  isNetwork,
  type BidNameRequest,
  type BroadcastResult,
  type MnemonicImportInput,
  type NameActionResult,
  type NameAvailability,
  type NameDetails,
  type Network,
  type NodeStatus,
  type OwnedName,
  type ReceiveAddress,
  type SendRequest,
  type TransactionPage,
  type TransactionQuery,
  type TransactionRecord,
  type TransferNameRequest,
  type UpdateNameRequest,
  type UpdatePreviewResult,
  type WalletBalance,
  type WalletStatus,
} from "@alice-hns-wallet/domain";
import { HsdHttpClient, HsdHttpError } from "./http.js";
import {
  hasOwner,
  toNameAvailability,
  toNameDetails,
  toOwnedName,
  toResourceData,
  toUpdatePreviewResult,
  type OwnershipInfo,
} from "./name-mapper.js";
import type { HandshakeNodeClient } from "./node-client.js";
import type { HandshakeWalletClient } from "./wallet-client.js";
import {
  rawAuctionSchema,
  rawCoinSchema,
  rawCovenantBroadcastSchema,
  rawCovenantPreviewSchema,
  rawNameInfoSchema,
  rawNameResourceSchema,
  rawNameSchema,
  rawNodeInfoSchema,
  rawTxPreviewSchema,
  rawTxSchema,
  rawWalletAddressSchema,
  rawWalletBalanceSchema,
  rawWalletInfoSchema,
  type RawCovenantPreview,
  type RawNameOwner,
  type RawWalletBalance,
} from "./raw-schemas.js";
import { toTransactionRecord } from "./transaction-mapper.js";
import { z } from "zod";

const MIN_SUPPORTED_MAJOR = 8;
const MAX_SUPPORTED_MAJOR = 9;

export function isSupportedHsdVersion(version: string): boolean {
  const major = Number(version.split(".")[0]);
  return Number.isInteger(major) && major >= MIN_SUPPORTED_MAJOR && major < MAX_SUPPORTED_MAJOR;
}

function toNetwork(raw: string): Network {
  if (!isNetwork(raw)) {
    throw new Error(`hsd reported an unknown network: ${raw}`);
  }
  return raw;
}

function toWalletBalance(raw: RawWalletBalance): WalletBalance {
  const confirmed = BigInt(raw.confirmed);
  const lockedConfirmed = BigInt(raw.lockedConfirmed);
  const lockedUnconfirmed = BigInt(raw.lockedUnconfirmed);
  const unconfirmed = BigInt(raw.unconfirmed);
  return {
    confirmed,
    unconfirmed,
    locked: lockedConfirmed + lockedUnconfirmed,
    spendable: confirmed - lockedConfirmed,
  };
}

/** encrypted:false means no passphrase was ever set — such a wallet is never locked. */
function isWalletLocked(master: { encrypted: boolean; until?: number }): boolean {
  if (!master.encrypted) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return !master.until || master.until <= nowSeconds;
}

export interface HsdV8AdapterOptions {
  nodeUrl: string;
  nodeApiKey: string;
  walletUrl: string;
  walletApiKey: string;
  walletId: string;
  timeoutMs?: number;
  concurrency?: number;
}

export class HsdV8Adapter implements HandshakeNodeClient, HandshakeWalletClient {
  private readonly node: HsdHttpClient;
  private readonly wallet: HsdHttpClient;
  private readonly walletId: string;

  constructor(options: HsdV8AdapterOptions) {
    this.node = new HsdHttpClient({
      baseUrl: options.nodeUrl,
      apiKey: options.nodeApiKey,
      timeoutMs: options.timeoutMs,
      concurrency: options.concurrency,
    });
    this.wallet = new HsdHttpClient({
      baseUrl: options.walletUrl,
      apiKey: options.walletApiKey,
      timeoutMs: options.timeoutMs,
      concurrency: options.concurrency,
    });
    this.walletId = options.walletId;
  }

  async getStatus(): Promise<NodeStatus> {
    const raw = rawNodeInfoSchema.parse(await this.node.get("/"));
    return {
      connected: true,
      version: raw.version,
      network: toNetwork(raw.network),
      chainHeight: raw.chain.height,
      peerCount: raw.pool.outbound + raw.pool.inbound,
      synced: raw.chain.progress >= 1,
      progress: raw.chain.progress,
    };
  }

  async getVersion(): Promise<string> {
    const raw = rawNodeInfoSchema.parse(await this.node.get("/"));
    return raw.version;
  }

  async getNetwork(): Promise<Network> {
    const raw = rawNodeInfoSchema.parse(await this.node.get("/"));
    return toNetwork(raw.network);
  }

  async getBalance(): Promise<WalletBalance> {
    const raw = rawWalletBalanceSchema.parse(
      await this.wallet.get(`/wallet/${this.walletId}/balance`),
    );
    return toWalletBalance(raw);
  }

  /**
   * hsd's wallet HTTP API doesn't expose a distinct "wallet height" or
   * "rescanning" flag; the wallet DB is kept in lockstep with the chain, so the
   * node's chain height is used as a close approximation. `rescanning` isn't
   * observable via this endpoint and is left false here (see WalletService for
   * the app-level rescan-in-progress flag).
   */
  async getWalletStatus(): Promise<WalletStatus> {
    const [nodeRaw, walletRaw] = await Promise.all([
      this.node.get("/"),
      this.wallet.get(`/wallet/${this.walletId}`),
    ]);
    const node = rawNodeInfoSchema.parse(nodeRaw);
    const walletInfo = rawWalletInfoSchema.parse(walletRaw);

    return {
      connected: true,
      walletId: this.walletId,
      network: toNetwork(walletInfo.network),
      walletHeight: node.chain.height,
      locked: isWalletLocked(walletInfo.master),
      rescanning: false,
    };
  }

  async getReceiveAddress(): Promise<ReceiveAddress> {
    const raw = rawWalletAddressSchema.parse(
      await this.wallet.post(`/wallet/${this.walletId}/address`, { account: "default" }),
    );
    return { address: raw.address, index: raw.index, used: false };
  }

  async send(request: SendRequest): Promise<BroadcastResult> {
    const raw = rawTxSchema.parse(
      await this.wallet.post(`/wallet/${this.walletId}/send`, {
        outputs: [{ address: request.address, value: Number(request.amount) }],
        rate: request.feeRate,
      }),
    );
    return { txid: raw.hash, fee: BigInt(raw.fee) };
  }

  /** POST .../create builds without broadcasting — a different response shape than send (see raw-schemas.ts). */
  async previewSend(request: SendRequest): Promise<BroadcastResult> {
    const raw = rawTxPreviewSchema.parse(
      await this.wallet.post(`/wallet/${this.walletId}/create`, {
        outputs: [{ address: request.address, value: Number(request.amount) }],
        rate: request.feeRate,
      }),
    );
    return { txid: raw.hash, fee: BigInt(raw.fee) };
  }

  /**
   * `reverse=true` returns newest-first, which is what a wallet history view expects;
   * "after" continues in that same order. hsd rejects any limit above 100.
   */
  async getTransactions(query: TransactionQuery): Promise<TransactionPage> {
    const limit = Math.min(query.limit ?? 50, 100);
    const params = new URLSearchParams({ limit: String(limit), reverse: "true" });
    if (query.cursor) params.set("after", query.cursor);

    const raw = z
      .array(rawTxSchema)
      .parse(await this.wallet.get(`/wallet/${this.walletId}/tx/history?${params.toString()}`));

    const items = raw.map(toTransactionRecord);
    const nextCursor = raw.length === limit ? (raw[raw.length - 1]?.hash ?? null) : null;
    return { items, nextCursor };
  }

  async getTransaction(txid: string): Promise<TransactionRecord | null> {
    try {
      const raw = rawTxSchema.parse(await this.wallet.get(`/wallet/${this.walletId}/tx/${txid}`));
      return toTransactionRecord(raw);
    } catch (error) {
      if (error instanceof HsdHttpError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async lock(): Promise<void> {
    await this.wallet.post(`/wallet/${this.walletId}/lock`);
  }

  async unlock(passphrase: string, timeoutSeconds: number): Promise<void> {
    await this.wallet.post(`/wallet/${this.walletId}/unlock`, {
      passphrase,
      timeout: timeoutSeconds,
    });
  }

  /** Hits the wallet server's rescan endpoint, not the node's chain `/reset` — that resets the chain itself. */
  async rescan(height: number): Promise<void> {
    await this.wallet.post("/rescan", { height });
  }

  async createWalletFromMnemonic(input: MnemonicImportInput): Promise<void> {
    await this.wallet.put(`/wallet/${input.walletId}`, {
      mnemonic: input.mnemonic,
      passphrase: input.passphrase,
    });
  }

  /** Spec §14.1: the ~100-name list is fetched in a single request; no per-name RPC calls here. */
  async getNames(): Promise<OwnedName[]> {
    const raw = z
      .array(rawNameSchema)
      .parse(await this.wallet.get(`/wallet/${this.walletId}/name`));
    return raw.map(toOwnedName);
  }

  async getName(name: string): Promise<NameDetails> {
    const raw = rawAuctionSchema.parse(
      await this.wallet.get(`/wallet/${this.walletId}/auction/${encodeURIComponent(name)}`),
    );

    const resource =
      raw.data.length > 0
        ? rawNameResourceSchema.nullable().parse(await this.node.rpc("getnameresource", [name]))
        : null;

    const ownership = await this.resolveOwnership(raw.owner);

    return toNameDetails(raw, resource, ownership);
  }

  /**
   * hsd's wallet name endpoints report the *global* auction outcome, not per-wallet ownership
   * (a wallet that lost a bid sees the same `owner`/`registered` fields as the winner). The only
   * reliable way to confirm this wallet actually controls the current owner outpoint is to check
   * whether that coin is in its own UTXO set.
   */
  private async resolveOwnership(owner: RawNameOwner): Promise<OwnershipInfo> {
    if (!hasOwner(owner)) return { owned: false, ownerAddress: null };

    try {
      const coin = rawCoinSchema.parse(
        await this.wallet.get(`/wallet/${this.walletId}/coin/${owner.hash}/${owner.index}`, false),
      );
      return { owned: true, ownerAddress: coin.address };
    } catch (error) {
      if (error instanceof HsdHttpError && error.status === 404) {
        return { owned: false, ownerAddress: null };
      }
      throw error;
    }
  }

  async previewUpdateName(request: UpdateNameRequest): Promise<UpdatePreviewResult> {
    const raw = await this.postCovenantOp(`/wallet/${this.walletId}/update`, {
      name: request.name,
      data: toResourceData(request.records),
      broadcast: false,
    });
    return toUpdatePreviewResult(raw, request.records);
  }

  async updateName(request: UpdateNameRequest): Promise<BroadcastResult> {
    return this.broadcastCovenantOp(`/wallet/${this.walletId}/update`, {
      name: request.name,
      data: toResourceData(request.records),
    });
  }

  async previewRenewName(name: string): Promise<BroadcastResult> {
    const raw = await this.postCovenantOp(`/wallet/${this.walletId}/renewal`, {
      name,
      broadcast: false,
    });
    return { txid: raw.hash, fee: BigInt(raw.fee) };
  }

  async renewName(name: string): Promise<BroadcastResult> {
    return this.broadcastCovenantOp(`/wallet/${this.walletId}/renewal`, { name });
  }

  /**
   * Spec §17.3: sequential (never parallel/all-or-nothing) so one failure can't corrupt coin
   * selection for the rest, with every name's own outcome preserved. Callers are expected to have
   * already filtered out non-renewable names (see NameService.renewNamesBatch) — anything that
   * reaches here is attempted and any hsd-level rejection becomes a "failed" result, never thrown.
   */
  async renewNames(names: string[]): Promise<NameActionResult[]> {
    const results: NameActionResult[] = [];
    for (const name of names) {
      try {
        const result = await this.renewName(name);
        results.push({ name, status: "success", txid: result.txid });
      } catch (error) {
        results.push({
          name,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  async previewTransferName(request: TransferNameRequest): Promise<BroadcastResult> {
    const raw = await this.postCovenantOp(`/wallet/${this.walletId}/transfer`, {
      name: request.name,
      address: request.address,
      broadcast: false,
    });
    return { txid: raw.hash, fee: BigInt(raw.fee) };
  }

  async transferName(request: TransferNameRequest): Promise<BroadcastResult> {
    return this.broadcastCovenantOp(`/wallet/${this.walletId}/transfer`, {
      name: request.name,
      address: request.address,
    });
  }

  async previewFinalizeName(name: string): Promise<BroadcastResult> {
    const raw = await this.postCovenantOp(`/wallet/${this.walletId}/finalize`, {
      name,
      broadcast: false,
    });
    return { txid: raw.hash, fee: BigInt(raw.fee) };
  }

  async finalizeName(name: string): Promise<BroadcastResult> {
    return this.broadcastCovenantOp(`/wallet/${this.walletId}/finalize`, { name });
  }

  async revokeName(name: string): Promise<BroadcastResult> {
    return this.broadcastCovenantOp(`/wallet/${this.walletId}/revoke`, { name });
  }

  /** Node-side lookup (spec §27.1) — works for any name, including ones this wallet has never opened. */
  async getNameAvailability(name: string): Promise<NameAvailability> {
    const raw = rawNameInfoSchema.parse(await this.node.rpc("getnameinfo", [name]));
    return toNameAvailability(name, raw);
  }

  async previewOpenName(name: string): Promise<BroadcastResult> {
    const raw = await this.postCovenantOp(`/wallet/${this.walletId}/open`, {
      name,
      broadcast: false,
    });
    return { txid: raw.hash, fee: BigInt(raw.fee) };
  }

  async openName(name: string): Promise<BroadcastResult> {
    return this.broadcastCovenantOp(`/wallet/${this.walletId}/open`, { name });
  }

  async previewBidName(request: BidNameRequest): Promise<BroadcastResult> {
    const raw = await this.postCovenantOp(`/wallet/${this.walletId}/bid`, {
      name: request.name,
      bid: Number(request.bid),
      lockup: Number(request.lockup),
      broadcast: false,
    });
    return { txid: raw.hash, fee: BigInt(raw.fee) };
  }

  async bidName(request: BidNameRequest): Promise<BroadcastResult> {
    return this.broadcastCovenantOp(`/wallet/${this.walletId}/bid`, {
      name: request.name,
      bid: Number(request.bid),
      lockup: Number(request.lockup),
    });
  }

  async previewRevealName(name: string): Promise<BroadcastResult> {
    const raw = await this.postCovenantOp(`/wallet/${this.walletId}/reveal`, {
      name,
      broadcast: false,
    });
    return { txid: raw.hash, fee: BigInt(raw.fee) };
  }

  async revealName(name: string): Promise<BroadcastResult> {
    return this.broadcastCovenantOp(`/wallet/${this.walletId}/reveal`, { name });
  }

  async previewRedeemName(name: string): Promise<BroadcastResult> {
    const raw = await this.postCovenantOp(`/wallet/${this.walletId}/redeem`, {
      name,
      broadcast: false,
    });
    return { txid: raw.hash, fee: BigInt(raw.fee) };
  }

  async redeemName(name: string): Promise<BroadcastResult> {
    return this.broadcastCovenantOp(`/wallet/${this.walletId}/redeem`, { name });
  }

  private async postCovenantOp(
    path: string,
    body: Record<string, unknown>,
  ): Promise<RawCovenantPreview> {
    return rawCovenantPreviewSchema.parse(await this.wallet.post(path, body));
  }

  /**
   * hsd returns null fee/rate on the broadcast (default) response for update/renewal/transfer/
   * finalize/revoke — unlike `/send` — so a `broadcast:false` preview call is made first purely to
   * learn the real fee, then the actual broadcast call gets the txid. Spec §12.4/§22.2 still holds:
   * the broadcast call itself is never retried, only this preview step (which touches no mempool
   * state) runs before it.
   */
  private async broadcastCovenantOp(
    path: string,
    body: Record<string, unknown>,
  ): Promise<BroadcastResult> {
    const preview = await this.postCovenantOp(path, { ...body, broadcast: false });
    const broadcast = rawCovenantBroadcastSchema.parse(
      await this.wallet.post(path, { ...body, broadcast: true }),
    );
    return { txid: broadcast.hash, fee: BigInt(preview.fee) };
  }
}
