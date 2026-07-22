import { z } from "zod";

/**
 * Shapes observed from a live hsd 8.0.0 regtest node (GET /, GET /wallet/:id,
 * GET /wallet/:id/balance). hsd does not publish a formal OpenAPI spec, so these
 * are validated against the real daemon rather than documentation.
 */

export const rawNodeInfoSchema = z.object({
  version: z.string(),
  network: z.string(),
  chain: z.object({
    height: z.number().int().nonnegative(),
    progress: z.number(),
  }),
  pool: z.object({
    outbound: z.number().int().nonnegative(),
    inbound: z.number().int().nonnegative(),
  }),
});

export type RawNodeInfo = z.infer<typeof rawNodeInfoSchema>;

export const rawWalletBalanceSchema = z.object({
  confirmed: z.number().int(),
  unconfirmed: z.number().int(),
  lockedConfirmed: z.number().int(),
  lockedUnconfirmed: z.number().int(),
});

export type RawWalletBalance = z.infer<typeof rawWalletBalanceSchema>;

export const rawWalletInfoSchema = z.object({
  network: z.string(),
  wid: z.number().int(),
  id: z.string(),
  watchOnly: z.boolean(),
  balance: rawWalletBalanceSchema,
});

export type RawWalletInfo = z.infer<typeof rawWalletInfoSchema>;

export const rawWalletAddressSchema = z.object({
  name: z.string(),
  account: z.number().int(),
  branch: z.number().int(),
  index: z.number().int(),
  address: z.string(),
});

export type RawWalletAddress = z.infer<typeof rawWalletAddressSchema>;
