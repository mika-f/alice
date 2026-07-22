import type { Network, NodeStatus } from "@alice-hns-wallet/domain";

export interface HandshakeNodeClient {
  getStatus(): Promise<NodeStatus>;
  getNetwork(): Promise<Network>;
  getVersion(): Promise<string>;
}
