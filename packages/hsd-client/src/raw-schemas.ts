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

/**
 * Shape of hsd's covenants/namestate.js NameState.toJSON(), as returned by
 * GET /wallet/:id/name, GET /wallet/:id/name/:name and GET /wallet/:id/auction/:name
 * (observed against a live hsd 8.0.0 regtest node — see packages/hsd-client/src/name-mapper.ts
 * for how these fields are interpreted).
 *
 * `stats` is a phase-dependent bag hsd computes server-side (bidPeriodEnd+blocksUntilReveal while
 * bidding, renewalPeriodEnd+blocksUntilExpire once registered, etc.) — deliberately loose here
 * rather than a discriminated union, since the mapper only ever looks for a `blocksUntil*` key and a
 * couple of well-known period-end keys.
 */
export const rawNameOwnerSchema = z.object({
  hash: z.string(),
  index: z.number().int().nonnegative(),
});

export type RawNameOwner = z.infer<typeof rawNameOwnerSchema>;

export const rawNameStatsSchema = z.record(z.string(), z.number()).nullable();

export const rawNameSchema = z.object({
  name: z.string(),
  nameHash: z.string(),
  state: z.enum(["OPENING", "LOCKED", "BIDDING", "REVEAL", "CLOSED", "REVOKED"]),
  height: z.number().int(),
  renewal: z.number().int(),
  owner: rawNameOwnerSchema,
  value: z.number().int(),
  highest: z.number().int(),
  /** Hex-encoded raw DNS Resource as committed on-chain; empty string when unset. */
  data: z.string(),
  transfer: z.number().int(),
  revoked: z.number().int(),
  claimed: z.number().int(),
  renewals: z.number().int(),
  registered: z.boolean(),
  expired: z.boolean(),
  weak: z.boolean(),
  stats: rawNameStatsSchema,
});

export type RawName = z.infer<typeof rawNameSchema>;

/**
 * hsd's wallet http.js `/wallet/:id/auction/:name` — a superset of rawNameSchema with bids/reveals
 * for every bidder tracked by this node, not just this wallet's own. `value` (the true bid amount)
 * is blinded on-chain until reveal, so it's only present when `own` is true and the wallet knows
 * its own blind; `lockup` (the visible output value covering the bid) is always present.
 */
export const rawAuctionBidSchema = z.object({
  prevout: z.object({ hash: z.string(), index: z.number().int() }),
  value: z.number().int().optional(),
  lockup: z.number().int(),
  height: z.number().int(),
  own: z.boolean(),
});

export const rawAuctionRevealSchema = z.object({
  prevout: z.object({ hash: z.string(), index: z.number().int() }),
  value: z.number().int(),
  height: z.number().int(),
  own: z.boolean(),
});

export const rawAuctionSchema = rawNameSchema.extend({
  bids: z.array(rawAuctionBidSchema),
  reveals: z.array(rawAuctionRevealSchema),
});

export type RawAuction = z.infer<typeof rawAuctionSchema>;

/** GET /wallet/:id/coin/:hash/:index — used only to confirm wallet ownership of a name's owner outpoint. */
export const rawCoinSchema = z.object({
  value: z.number().int(),
  address: z.string(),
});

export type RawCoin = z.infer<typeof rawCoinSchema>;

/**
 * hsd's dns/resource.js Resource.toJSON(). `type` is a free-form string — hsd supports record
 * kinds beyond the 7 this app decodes (spec §16.1), so this is intentionally permissive and the
 * mapper falls back to an UNKNOWN record for anything it doesn't recognize.
 */
export const rawDnsRecordSchema = z.object({ type: z.string() }).passthrough();

export const rawNameResourceSchema = z.object({
  records: z.array(rawDnsRecordSchema),
});

export type RawDnsRecord = z.infer<typeof rawDnsRecordSchema>;
export type RawNameResource = z.infer<typeof rawNameResourceSchema>;

const rawCovenantOutputSchema = z.object({
  value: z.number().int(),
  address: z.string().nullable(),
  covenant: rawCovenantSchema,
});

/**
 * `POST /wallet/:id/{update,renewal,transfer,finalize,revoke}` with `broadcast:false` — the full
 * signed-but-unbroadcast MTX. Used for fee estimation and (for update) reading back the raw
 * resource bytes hsd would commit, without ever touching the mempool.
 */
export const rawCovenantPreviewSchema = z.object({
  hash: z.string(),
  fee: z.number().int(),
  rate: z.number().int(),
  outputs: z.array(rawCovenantOutputSchema),
});

export type RawCovenantPreview = z.infer<typeof rawCovenantPreviewSchema>;

/**
 * Same endpoints with `broadcast:true` (the default). Unlike `/wallet/:id/send`, hsd omits
 * `fee`/`rate` entirely here — the plain broadcast TX JSON has no embedded coin view to compute
 * them from — so HsdV8Adapter gets an accurate fee from a preceding `broadcast:false` call instead.
 */
export const rawCovenantBroadcastSchema = z.object({
  hash: z.string(),
});

export type RawCovenantBroadcast = z.infer<typeof rawCovenantBroadcastSchema>;

/**
 * Node RPC `getnameinfo` — observed against a live hsd 8.0.0 regtest node. `info` is `null` when
 * the name has never been opened (no auction record exists anywhere); when present its shape is
 * identical to `rawNameSchema` (this is the same `NameState.toJSON()` used by the wallet's own
 * `/name` endpoints, just reached via the node instead of a wallet). `start.reserved` is hsd's own
 * ICANN-reserved-name flag — used directly instead of bundling a reserved-name list (spec §27.1).
 */
export const rawNameInfoSchema = z.object({
  start: z.object({
    reserved: z.boolean(),
    week: z.number().int(),
    start: z.number().int(),
  }),
  info: rawNameSchema.nullable(),
});

export type RawNameInfo = z.infer<typeof rawNameInfoSchema>;
