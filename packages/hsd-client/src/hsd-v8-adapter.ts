import {
  isNetwork,
  type Network,
  type NodeStatus,
  type WalletBalance,
} from "@alice-hns-wallet/domain";
import { HsdHttpClient } from "./http.js";
import type { HandshakeNodeClient } from "./node-client.js";
import type { HandshakeWalletClient } from "./wallet-client.js";
import { rawNodeInfoSchema, rawWalletBalanceSchema, type RawWalletBalance } from "./raw-schemas.js";

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

  getWalletStatus(): ReturnType<HandshakeWalletClient["getWalletStatus"]> {
    throw new Error("not implemented: getWalletStatus (Phase 1)");
  }

  getTransactions(): ReturnType<HandshakeWalletClient["getTransactions"]> {
    throw new Error("not implemented: getTransactions (Phase 2)");
  }

  getReceiveAddress(): ReturnType<HandshakeWalletClient["getReceiveAddress"]> {
    throw new Error("not implemented: getReceiveAddress (Phase 2)");
  }

  send(): ReturnType<HandshakeWalletClient["send"]> {
    throw new Error("not implemented: send (Phase 2)");
  }

  lock(): ReturnType<HandshakeWalletClient["lock"]> {
    throw new Error("not implemented: lock (Phase 2)");
  }

  unlock(): ReturnType<HandshakeWalletClient["unlock"]> {
    throw new Error("not implemented: unlock (Phase 2)");
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
