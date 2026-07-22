import type {
  BroadcastResult,
  NameActionResult,
  NameBid,
  NameDetails,
  NameReveal,
  OwnedName,
  UpdatePreviewResult,
} from "@alice-hns-wallet/domain";
import { validateResource } from "@alice-hns-wallet/domain";
import {
  nameMetaRequestSchema,
  renewNamesBatchRequestSchema,
  revokeNameRequestSchema,
  transferNameRequestSchema,
  updateNameRequestSchema,
} from "@alice-hns-wallet/schemas";
import { Hono } from "hono";
import type { Db } from "../db/client.js";
import type { Env } from "../env.js";
import { auditLog } from "../middleware/audit.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireReauth } from "../middleware/reauth.js";
import { requireAuth } from "../middleware/session.js";
import { getAdmin, verifyCredentials } from "../services/auth-service.js";
import type { HsdConnectionManager } from "../services/hsd-connection-manager.js";
import type { RescanTracker } from "../services/rescan-tracker.js";
import {
  finalizeName,
  getNameDetail,
  getNameResource,
  listNames,
  previewFinalizeName,
  previewRenewName,
  previewTransferName,
  previewUpdateName,
  renewName,
  renewNamesBatch,
  revokeName,
  setNameMeta,
  transferName,
  updateName,
} from "../services/name-service.js";
import { verifyAndConsumeRecoveryCode, verifyTotpCode } from "../services/totp-service.js";
import { getWalletStatus } from "../services/wallet-service.js";
import type { AppEnv } from "../types.js";

function serializeOwnedName(item: OwnedName) {
  return {
    name: item.name,
    state: item.state,
    owned: item.owned,
    renewalHeight: item.renewalHeight,
    expirationHeight: item.expirationHeight,
    blocksRemaining: item.blocksRemaining,
    transferState: item.transferState,
    resourceSummary: item.resourceSummary,
    label: item.label,
    memo: item.memo,
    updatedAt: item.updatedAt,
  };
}

function serializeBid(bid: NameBid) {
  return {
    value: bid.value !== null ? bid.value.toString() : null,
    lockup: bid.lockup.toString(),
    height: bid.height,
    own: bid.own,
  };
}

function serializeReveal(reveal: NameReveal) {
  return { value: reveal.value.toString(), height: reveal.height, own: reveal.own };
}

function serializeNameDetails(detail: NameDetails) {
  return {
    ...serializeOwnedName(detail),
    nameHash: detail.nameHash,
    ownerAddress: detail.ownerAddress,
    blockHeight: detail.blockHeight,
    resource: detail.resource,
    bids: detail.bids.map(serializeBid),
    reveals: detail.reveals.map(serializeReveal),
  };
}

function serializeBroadcastResult(result: BroadcastResult) {
  return { txid: result.txid, fee: result.fee.toString() };
}

function serializeUpdatePreview(result: UpdatePreviewResult) {
  return { fee: result.fee.toString(), resource: result.resource };
}

function serializeActionResults(results: NameActionResult[]) {
  return results.map((r) => ({ name: r.name, status: r.status, txid: r.txid, reason: r.reason }));
}

export function createNameRoutes(
  db: Db,
  env: Env,
  hsdManager: HsdConnectionManager,
  rescanTracker: RescanTracker,
) {
  const app = new Hono<AppEnv>();

  const previewLimiter = rateLimit({ windowMs: 60_000, max: 30, trustProxy: env.TRUST_PROXY });
  const updateLimiter = rateLimit({ windowMs: 60_000, max: 20, trustProxy: env.TRUST_PROXY });
  const renewLimiter = rateLimit({ windowMs: 60_000, max: 20, trustProxy: env.TRUST_PROXY });
  const renewBatchLimiter = rateLimit({ windowMs: 60_000, max: 5, trustProxy: env.TRUST_PROXY });
  const transferLimiter = rateLimit({ windowMs: 60_000, max: 10, trustProxy: env.TRUST_PROXY });
  const finalizeLimiter = rateLimit({ windowMs: 60_000, max: 10, trustProxy: env.TRUST_PROXY });
  const revokeLimiter = rateLimit({ windowMs: 60_000, max: 5, trustProxy: env.TRUST_PROXY });

  app.get("/names", requireAuth(), async (c) => {
    const names = await listNames(db, hsdManager.get());
    return c.json(names.map(serializeOwnedName));
  });

  app.get("/names/:name", requireAuth(), async (c) => {
    const detail = await getNameDetail(db, hsdManager.get(), c.req.param("name"));
    return c.json(serializeNameDetails(detail));
  });

  app.get("/names/:name/resource", requireAuth(), async (c) => {
    const resource = await getNameResource(hsdManager.get(), c.req.param("name"));
    return c.json(resource);
  });

  app.put("/names/:name/meta", requireAuth(), async (c) => {
    const parsed = nameMetaRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    setNameMeta(db, c.req.param("name"), parsed.data);
    return c.body(null, 204);
  });

  /** Spec §16.2/§16.3: validated, priced, and previewed without ever touching the mempool. */
  app.post("/names/:name/update/preview", requireAuth(), previewLimiter, async (c) => {
    const parsed = updateNameRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

    const issues = validateResource(parsed.data.records);
    if (issues.length > 0) return c.json({ error: "Invalid resource", issues }, 400);

    const result = await previewUpdateName(
      hsdManager.get(),
      c.req.param("name"),
      parsed.data.records,
    );
    return c.json(serializeUpdatePreview(result));
  });

  /** Spec §7.4: DNS updates require a fresh reauth. */
  app.post(
    "/names/:name/update",
    auditLog(db, env, "name.update", (c) => c.req.param("name")),
    requireReauth(),
    updateLimiter,
    async (c) => {
      const parsed = updateNameRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

      const issues = validateResource(parsed.data.records);
      if (issues.length > 0) return c.json({ error: "Invalid resource", issues }, 400);

      const status = await getWalletStatus(hsdManager.get(), rescanTracker);
      if (status.locked) return c.json({ error: "Wallet is locked" }, 409);

      const result = await updateName(
        db,
        hsdManager.get(),
        c.req.param("name"),
        parsed.data.records,
      );
      return c.json(serializeBroadcastResult(result));
    },
  );

  app.post("/names/:name/renew/preview", requireAuth(), previewLimiter, async (c) => {
    const result = await previewRenewName(hsdManager.get(), c.req.param("name"));
    return c.json(serializeBroadcastResult(result));
  });

  app.post(
    "/names/:name/renew",
    auditLog(db, env, "name.renew", (c) => c.req.param("name")),
    requireReauth(),
    renewLimiter,
    async (c) => {
      const status = await getWalletStatus(hsdManager.get(), rescanTracker);
      if (status.locked) return c.json({ error: "Wallet is locked" }, 409);

      const result = await renewName(db, hsdManager.get(), c.req.param("name"));
      return c.json(serializeBroadcastResult(result));
    },
  );

  /** Spec §17.3: per-name success/failure/skip, never an opaque all-or-nothing batch. */
  app.post(
    "/names/renew-batch",
    auditLog(db, env, "name.renew_batch"),
    requireReauth(),
    renewBatchLimiter,
    async (c) => {
      const parsed = renewNamesBatchRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

      const results = await renewNamesBatch(db, hsdManager.get(), parsed.data.names);
      return c.json(serializeActionResults(results));
    },
  );

  app.post("/names/:name/transfer/preview", requireAuth(), previewLimiter, async (c) => {
    const parsed = transferNameRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

    const result = await previewTransferName(
      hsdManager.get(),
      c.req.param("name"),
      parsed.data.address,
    );
    return c.json(serializeBroadcastResult(result));
  });

  app.post(
    "/names/:name/transfer",
    auditLog(db, env, "name.transfer", (c) => c.req.param("name")),
    requireReauth(),
    transferLimiter,
    async (c) => {
      const parsed = transferNameRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

      const status = await getWalletStatus(hsdManager.get(), rescanTracker);
      if (status.locked) return c.json({ error: "Wallet is locked" }, 409);

      const result = await transferName(
        db,
        hsdManager.get(),
        c.req.param("name"),
        parsed.data.address,
      );
      return c.json(serializeBroadcastResult(result));
    },
  );

  app.post("/names/:name/finalize/preview", requireAuth(), previewLimiter, async (c) => {
    const result = await previewFinalizeName(hsdManager.get(), c.req.param("name"));
    return c.json(serializeBroadcastResult(result));
  });

  app.post(
    "/names/:name/finalize",
    auditLog(db, env, "name.finalize", (c) => c.req.param("name")),
    requireReauth(),
    finalizeLimiter,
    async (c) => {
      const status = await getWalletStatus(hsdManager.get(), rescanTracker);
      if (status.locked) return c.json({ error: "Wallet is locked" }, 409);

      const result = await finalizeName(db, hsdManager.get(), c.req.param("name"));
      return c.json(serializeBroadcastResult(result));
    },
  );

  /**
   * Spec §19.2: revoke is irreversible, so it demands both a fresh password AND a fresh TOTP (or
   * recovery) code in the same request — stricter than the general single-factor reauth every
   * other write here uses. TOTP must already be enabled; there's no factor to check otherwise.
   */
  app.post(
    "/names/:name/revoke",
    auditLog(db, env, "name.revoke", (c) => c.req.param("name")),
    requireReauth(),
    revokeLimiter,
    async (c) => {
      const parsed = revokeNameRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

      const record = getAdmin(db);
      if (!record) return c.json({ error: "Admin account does not exist" }, 500);
      if (!record.totpEnabled) {
        return c.json({ error: "TOTP must be enabled to revoke a name" }, 403);
      }

      const passwordValid =
        (await verifyCredentials(db, {
          username: record.username,
          password: parsed.data.password,
        })) !== null;
      if (!passwordValid) return c.json({ error: "Invalid password" }, 401);

      const codeValid =
        verifyTotpCode(db, env.ENCRYPTION_KEY, parsed.data.code) ||
        (await verifyAndConsumeRecoveryCode(db, parsed.data.code));
      if (!codeValid) return c.json({ error: "Invalid TOTP code" }, 401);

      const status = await getWalletStatus(hsdManager.get(), rescanTracker);
      if (status.locked) return c.json({ error: "Wallet is locked" }, 409);

      const result = await revokeName(db, hsdManager.get(), c.req.param("name"));
      return c.json(serializeBroadcastResult(result));
    },
  );

  return app;
}
