import {
  isNetwork,
  type BroadcastResult,
  type MnemonicImportInput,
  type Network,
  type NodeStatus,
  type ReceiveAddress,
  type SendRequest,
  type TransactionPage,
  type TransactionQuery,
  type WalletBalance,
  type WalletStatus,
} from "@alice-hns-wallet/domain";
import { HsdHttpClient } from "./http.js";
import type { HandshakeNodeClient } from "./node-client.js";
import type { HandshakeWalletClient } from "./wallet-client.js";
import {
  rawNodeInfoSchema,
  rawTxPreviewSchema,
  rawTxSchema,
  rawWalletAddressSchema,
  rawWalletBalanceSchema,
  rawWalletInfoSchema,
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

  getNames(): ReturnType<HandshakeWalletClient["getNames"]> {
    throw new Error("not implemented: getNames (Phase 3)");
  }

  getName(): ReturnType<HandshakeWalletClient["getName"]> {
    throw new Error("not implemented: getName (Phase 3)");
  }

  updateName(): ReturnType<HandshakeWalletClient["updateName"]> {
    throw new Error("not implemented: updateName (Phase 4)");
  }

  renewName(): ReturnType<HandshakeWalletClient["renewName"]> {
    throw new Error("not implemented: renewName (Phase 4)");
  }

  renewNames(): ReturnType<HandshakeWalletClient["renewNames"]> {
    throw new Error("not implemented: renewNames (Phase 4)");
  }

  transferName(): ReturnType<HandshakeWalletClient["transferName"]> {
    throw new Error("not implemented: transferName (Phase 4)");
  }

  finalizeName(): ReturnType<HandshakeWalletClient["finalizeName"]> {
    throw new Error("not implemented: finalizeName (Phase 4)");
  }

  revokeName(): ReturnType<HandshakeWalletClient["revokeName"]> {
    throw new Error("not implemented: revokeName (Phase 4)");
  }
}
