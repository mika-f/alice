import type { BroadcastResult, TransactionRecord, WalletBalance } from "@alice-hns-wallet/domain";
import {
  addressLabelRequestSchema,
  mnemonicImportRequestSchema,
  sendRequestSchema,
  txMetaRequestSchema,
  unlockRequestSchema,
} from "@alice-hns-wallet/schemas";
import { Hono } from "hono";
import type { Db } from "../db/client.js";
import type { Env } from "../env.js";
import { auditLog } from "../middleware/audit.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireReauth } from "../middleware/reauth.js";
import { requireAuth } from "../middleware/session.js";
import type { HsdConnectionManager } from "../services/hsd-connection-manager.js";
import {
  getBalance,
  getWalletStatus,
  issueReceiveAddress,
  listAddressHistory,
  lockWallet,
  importMnemonic,
  previewSend,
  send,
  setAddressLabel,
  setTxMeta,
  getTransactions,
  unlockWallet,
} from "../services/wallet-service.js";
import type { AppEnv } from "../types.js";

function serializeBalance(balance: WalletBalance) {
  return {
    confirmed: balance.confirmed.toString(),
    unconfirmed: balance.unconfirmed.toString(),
    locked: balance.locked.toString(),
    spendable: balance.spendable.toString(),
  };
}

function serializeBroadcastResult(result: BroadcastResult) {
  return { txid: result.txid, fee: result.fee.toString() };
}

function serializeTransaction(tx: TransactionRecord) {
  return {
    txid: tx.txid,
    kind: tx.kind,
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    timestamp: tx.timestamp,
    blockHeight: tx.blockHeight,
    confirmations: tx.confirmations,
    status: tx.status,
    label: tx.label,
    memo: tx.memo,
    inputs: tx.inputs.map((input) => ({
      address: input.address,
      value: input.value?.toString(),
    })),
    outputs: tx.outputs.map((output) => ({
      address: output.address,
      value: output.value.toString(),
      covenant: output.covenant,
    })),
  };
}

export function createWalletRoutes(db: Db, env: Env, hsdManager: HsdConnectionManager) {
  const app = new Hono<AppEnv>();

  const estimateLimiter = rateLimit({ windowMs: 60_000, max: 30, trustProxy: env.TRUST_PROXY });
  const sendLimiter = rateLimit({ windowMs: 60_000, max: 10, trustProxy: env.TRUST_PROXY });
  const unlockLimiter = rateLimit({ windowMs: 60_000, max: 10, trustProxy: env.TRUST_PROXY });
  const importLimiter = rateLimit({ windowMs: 60_000, max: 5, trustProxy: env.TRUST_PROXY });

  app.get("/wallet/balance", requireAuth(), async (c) => {
    const balance = await getBalance(hsdManager.get());
    return c.json(serializeBalance(balance));
  });

  app.get("/wallet/status", requireAuth(), async (c) => {
    const status = await getWalletStatus(hsdManager.get());
    return c.json(status);
  });

  app.post("/wallet/receive-address", requireAuth(), async (c) => {
    const address = await issueReceiveAddress(db, hsdManager.get());
    return c.json(address);
  });

  app.get("/wallet/addresses", requireAuth(), async (c) => {
    const history = await listAddressHistory(db, hsdManager.get());
    return c.json(history.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })));
  });

  app.put("/wallet/addresses/:address/meta", requireAuth(), async (c) => {
    const parsed = addressLabelRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    setAddressLabel(db, c.req.param("address"), parsed.data.label);
    return c.body(null, 204);
  });

  app.get("/wallet/transactions", requireAuth(), async (c) => {
    const limitParam = c.req.query("limit");
    const cursor = c.req.query("cursor");
    const limit = limitParam ? Number(limitParam) : undefined;
    const page = await getTransactions(db, hsdManager.get(), { cursor, limit });
    return c.json({ items: page.items.map(serializeTransaction), nextCursor: page.nextCursor });
  });

  app.put("/wallet/transactions/:txid/meta", requireAuth(), async (c) => {
    const parsed = txMetaRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    setTxMeta(db, c.req.param("txid"), parsed.data);
    return c.body(null, 204);
  });

  app.post("/wallet/send/estimate", requireAuth(), estimateLimiter, async (c) => {
    const parsed = sendRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

    const result = await previewSend(hsdManager.get(), {
      address: parsed.data.address,
      amount: BigInt(parsed.data.amount),
      feeRate: parsed.data.feeRate,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return c.json(serializeBroadcastResult(result));
  });

  /** Spec §7.4 + §12.4: HNS sends require a fresh reauth and are never auto-retried. */
  app.post(
    "/wallet/send",
    auditLog(db, env, "wallet.send"),
    requireReauth(),
    sendLimiter,
    async (c) => {
      const parsed = sendRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

      const status = await getWalletStatus(hsdManager.get());
      if (status.locked) return c.json({ error: "Wallet is locked" }, 409);

      const result = await send(db, hsdManager.get(), {
        address: parsed.data.address,
        amount: BigInt(parsed.data.amount),
        feeRate: parsed.data.feeRate,
        label: parsed.data.label,
        memo: parsed.data.memo,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      return c.json(serializeBroadcastResult(result));
    },
  );

  app.post("/wallet/lock", auditLog(db, env, "wallet.lock"), requireAuth(), async (c) => {
    await lockWallet(hsdManager.get());
    return c.body(null, 204);
  });

  app.post(
    "/wallet/unlock",
    auditLog(db, env, "wallet.unlock"),
    requireAuth(),
    unlockLimiter,
    async (c) => {
      const parsed = unlockRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

      try {
        await unlockWallet(hsdManager.get(), parsed.data.passphrase, parsed.data.timeoutSeconds);
      } catch {
        return c.json({ error: "Invalid passphrase" }, 401);
      }
      return c.body(null, 204);
    },
  );

  /** Spec §7.4: importing a wallet requires a fresh reauth. */
  app.post(
    "/wallet/import/mnemonic",
    auditLog(db, env, "wallet.import_mnemonic"),
    requireReauth(),
    importLimiter,
    async (c) => {
      const parsed = mnemonicImportRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

      await importMnemonic(hsdManager.get(), parsed.data);
      return c.body(null, 204);
    },
  );

  return app;
}
