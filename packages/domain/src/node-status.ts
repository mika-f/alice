import type { Network } from "./network.js";

export interface NodeStatus {
  connected: boolean;
  version: string;
  network: Network;
  chainHeight: number;
  peerCount: number;
  synced: boolean;
  progress: number;
}

export interface WalletStatus {
  connected: boolean;
  walletId: string;
  network: Network;
  walletHeight: number;
  locked: boolean;
  rescanning: boolean;
}
