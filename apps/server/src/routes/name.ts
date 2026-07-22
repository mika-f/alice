import type { NameBid, NameDetails, NameReveal, OwnedName } from "@alice-hns-wallet/domain";
import { nameMetaRequestSchema } from "@alice-hns-wallet/schemas";
import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { requireAuth } from "../middleware/session.js";
import type { HsdConnectionManager } from "../services/hsd-connection-manager.js";
import {
  getNameDetail,
  getNameResource,
  listNames,
  setNameMeta,
} from "../services/name-service.js";
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

export function createNameRoutes(db: Db, hsdManager: HsdConnectionManager) {
  const app = new Hono<AppEnv>();

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

  return app;
}
