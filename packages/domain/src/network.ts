export const NETWORKS = ["main", "testnet", "regtest", "simnet"] as const;

export type Network = (typeof NETWORKS)[number];

export function isNetwork(value: string): value is Network {
  return (NETWORKS as readonly string[]).includes(value);
}
