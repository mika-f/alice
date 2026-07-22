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

/**
 * `until` is a unix-seconds expiry only present once a passphrase has been set;
 * `encrypted: false` means the wallet has no passphrase and is never locked.
 */
export const rawWalletMasterSchema = z.object({
  encrypted: z.boolean(),
  until: z.number().optional(),
});

export const rawWalletInfoSchema = z.object({
  network: z.string(),
  wid: z.number().int(),
  id: z.string(),
  watchOnly: z.boolean(),
  master: rawWalletMasterSchema,
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

const rawCovenantSchema = z.object({
  type: z.number().int(),
  action: z.string(),
  items: z.array(z.string()),
});

const rawTxInputSchema = z.object({
  value: z.number().int().nullable(),
  address: z.string().nullable(),
  path: z.object({ name: z.string(), account: z.number().int() }).nullable(),
});

const rawTxOutputSchema = z.object({
  value: z.number().int(),
  address: z.string().nullable(),
  covenant: rawCovenantSchema,
  path: z.object({ name: z.string(), account: z.number().int() }).nullable(),
});

/** Shared shape returned by GET /wallet/:id/tx/history and POST .../send (a broadcast/recorded tx). */
export const rawTxSchema = z.object({
  hash: z.string(),
  height: z.number().int(),
  time: z.number().int(),
  fee: z.number().int(),
  rate: z.number().int(),
  confirmations: z.number().int().nonnegative(),
  inputs: z.array(rawTxInputSchema),
  outputs: z.array(rawTxOutputSchema),
});

export type RawTx = z.infer<typeof rawTxSchema>;

/**
 * POST /wallet/:id/create returns the raw built MTX (never touches the wallet DB
 * or mempool), which is a *different* shape from /send and /tx/history — no
 * `height`/`confirmations`/output `path`, since it was never recorded anywhere.
 */
export const rawTxPreviewSchema = z.object({
  hash: z.string(),
  fee: z.number().int(),
  rate: z.number().int(),
});

export type RawTxPreview = z.infer<typeof rawTxPreviewSchema>;
