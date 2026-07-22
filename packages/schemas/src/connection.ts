import { z } from "zod";
import { networkSchema } from "./network.js";

export const connectionConfigSchema = z.object({
  displayName: z.string().min(1).max(120),
  nodeUrl: z.string().url(),
  walletUrl: z.string().url(),
  nodeApiKey: z.string().min(1),
  walletApiKey: z.string().min(1),
  walletId: z.string().min(1),
  network: networkSchema,
  timeoutMs: z.number().int().positive().max(60_000).default(10_000),
  tlsVerify: z.boolean().default(true),
});

export const connectionTestResultSchema = z.object({
  nodeReachable: z.boolean(),
  walletReachable: z.boolean(),
  authenticated: z.boolean(),
  hsdVersion: z.string().nullable(),
  networkMatches: z.boolean(),
  walletExists: z.boolean(),
  walletUsable: z.boolean(),
  errors: z.array(z.string()),
});

export type ConnectionConfig = z.infer<typeof connectionConfigSchema>;
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;
