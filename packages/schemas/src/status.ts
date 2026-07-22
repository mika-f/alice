import { z } from "zod";
import { networkSchema } from "./network.js";

/**
 * Node fields are nullable because they're unavailable when hsd can't be reached;
 * `connected` is the field to branch on, not the presence of the others.
 */
export const nodeStatusResponseSchema = z.object({
  connected: z.boolean(),
  version: z.string().nullable(),
  network: networkSchema.nullable(),
  chainHeight: z.number().int().nonnegative().nullable(),
  peerCount: z.number().int().nonnegative().nullable(),
  synced: z.boolean(),
  progress: z.number().min(0).max(1),
});

export const walletStatusResponseSchema = z.object({
  connected: z.boolean(),
  network: networkSchema.nullable(),
  walletHeight: z.number().int().nonnegative().nullable(),
  locked: z.boolean(),
  rescanning: z.boolean(),
});

export const dashboardWarningResponseSchema = z.object({
  type: z.enum([
    "node-disconnected",
    "wallet-disconnected",
    "node-unsynced",
    "wallet-unsynced",
    "network-mismatch",
    "wallet-locked",
    "hsd-version-unsupported",
    "backup-stale",
  ]),
  message: z.string(),
});

export const statusResponseSchema = z.object({
  node: nodeStatusResponseSchema,
  wallet: walletStatusResponseSchema,
  warnings: z.array(dashboardWarningResponseSchema),
  lastUpdated: z.number(),
});

export type NodeStatusResponse = z.infer<typeof nodeStatusResponseSchema>;
export type WalletStatusResponse = z.infer<typeof walletStatusResponseSchema>;
export type DashboardWarningResponse = z.infer<typeof dashboardWarningResponseSchema>;
export type StatusResponse = z.infer<typeof statusResponseSchema>;
