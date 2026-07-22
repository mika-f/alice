import { z } from "zod";
import { networkSchema } from "./network.js";

export const nodeStatusResponseSchema = z.object({
  connected: z.boolean(),
  version: z.string(),
  network: networkSchema,
  chainHeight: z.number().int().nonnegative(),
  peerCount: z.number().int().nonnegative(),
  synced: z.boolean(),
  progress: z.number().min(0).max(1),
});

export const walletStatusResponseSchema = z.object({
  connected: z.boolean(),
  walletId: z.string().min(1),
  network: networkSchema,
  walletHeight: z.number().int().nonnegative(),
  locked: z.boolean(),
  rescanning: z.boolean(),
});

export const statusResponseSchema = z.object({
  node: nodeStatusResponseSchema,
  wallet: walletStatusResponseSchema,
});

export type NodeStatusResponse = z.infer<typeof nodeStatusResponseSchema>;
export type WalletStatusResponse = z.infer<typeof walletStatusResponseSchema>;
export type StatusResponse = z.infer<typeof statusResponseSchema>;
