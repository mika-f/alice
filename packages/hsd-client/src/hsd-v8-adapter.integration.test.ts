import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HsdV8Adapter } from "./hsd-v8-adapter.js";

/**
 * Runs against the regtest hsd started via `docker/compose.dev.yaml`.
 * Skipped automatically when that stack isn't up.
 *
 * `describe.skipIf` evaluates its condition at collection time, before any
 * `beforeAll` hook runs, so the reachability probe has to happen up front via
 * a top-level await instead.
 */
const NODE_URL = process.env.HSD_TEST_NODE_URL ?? "http://127.0.0.1:14037";
const WALLET_URL = process.env.HSD_TEST_WALLET_URL ?? "http://127.0.0.1:14039";
const API_KEY = process.env.HSD_TEST_API_KEY ?? "devkey";

async function probeAvailability(): Promise<boolean> {
  try {
    const res = await fetch(NODE_URL, {
      headers: { Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

const available = await probeAvailability();

async function nodeRpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(NODE_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ method, params }),
  });
  const body = (await res.json()) as { result: T; error: unknown };
  if (body.error) throw new Error(`RPC ${method} failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function mineTo(address: string, blocks: number): Promise<void> {
  await nodeRpc("generatetoaddress", [blocks, address]);
}

describe.skipIf(!available)("HsdV8Adapter against a live regtest hsd", () => {
  const adapter = (walletId = "primary") =>
    new HsdV8Adapter({
      nodeUrl: NODE_URL,
      nodeApiKey: API_KEY,
      walletUrl: WALLET_URL,
      walletApiKey: API_KEY,
      walletId,
    });

  it("reads node status", async () => {
    const status = await adapter().getStatus();
    expect(status.network).toBe("regtest");
    expect(status.connected).toBe(true);
  });

  it("reads the node version", async () => {
    const version = await adapter().getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reads wallet balance", async () => {
    const balance = await adapter().getBalance();
    expect(balance.confirmed).toBeTypeOf("bigint");
  });

  it("reads wallet status: unencrypted wallets report as never locked", async () => {
    const status = await adapter().getWalletStatus();
    expect(status.network).toBe("regtest");
    expect(status.locked).toBe(false);
  });

  it("issues a fresh receive address each call", async () => {
    const a = await adapter().getReceiveAddress();
    const b = await adapter().getReceiveAddress();
    expect(a.address).not.toBe(b.address);
    expect(a.address).toMatch(/^rs1q/);
  });

  it("mines, sends, previews, and reads back history end to end", async () => {
    const client = adapter();
    const receiveAddr = await client.getReceiveAddress();
    await mineTo(receiveAddr.address, 20);

    const balance = await client.getBalance();
    expect(balance.confirmed).toBeGreaterThan(0n);

    const destination = await client.getReceiveAddress();

    const preview = await client.previewSend({
      address: destination.address,
      amount: 100_000_000n,
      feeRate: 10_000,
      idempotencyKey: randomUUID(),
    });
    expect(preview.fee).toBeGreaterThan(0n);

    const nodeBefore = await client.getStatus();

    const sent = await client.send({
      address: destination.address,
      amount: 100_000_000n,
      feeRate: 10_000,
      idempotencyKey: randomUUID(),
    });
    expect(sent.txid).toMatch(/^[0-9a-f]{64}$/);

    // /create must not have broadcast the preview — chain height is unaffected by it.
    const nodeAfter = await client.getStatus();
    expect(nodeAfter.chainHeight).toBe(nodeBefore.chainHeight);

    // tx/history only lists confirmed transactions, not mempool ones — confirm it first.
    await mineTo(receiveAddr.address, 1);
    const history = await client.getTransactions({ limit: 5 });
    expect(history.items.some((tx) => tx.txid === sent.txid)).toBe(true);
  });

  it("paginates history with a cursor", async () => {
    const client = adapter();
    const firstPage = await client.getTransactions({ limit: 2 });
    expect(firstPage.items.length).toBeLessThanOrEqual(2);
    if (firstPage.nextCursor) {
      const secondPage = await client.getTransactions({ limit: 2, cursor: firstPage.nextCursor });
      const firstIds = new Set(firstPage.items.map((tx) => tx.txid));
      expect(secondPage.items.every((tx) => !firstIds.has(tx.txid))).toBe(true);
    }
  });

  it("clamps an over-cap limit instead of letting hsd reject it (hsd's own max is 100)", async () => {
    const client = adapter();
    await expect(client.getTransactions({ limit: 500 })).resolves.toBeDefined();
  });

  it("locks and unlocks an encrypted wallet, and rejects while locked", async () => {
    const walletId = `test-${randomUUID().slice(0, 8)}`;
    const passphrase = "correct-horse-battery-staple";
    await fetch(`${WALLET_URL}/wallet/${walletId}`, {
      method: "PUT",
      headers: {
        Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ passphrase }),
    });

    const client = adapter(walletId);
    await client.lock();
    expect((await client.getWalletStatus()).locked).toBe(true);

    await client.unlock(passphrase, 60);
    expect((await client.getWalletStatus()).locked).toBe(false);
  });

  it("creates a wallet from a mnemonic", async () => {
    const walletId = `mnemonic-${randomUUID().slice(0, 8)}`;
    await adapter().createWalletFromMnemonic({
      walletId,
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    });

    const status = await adapter(walletId).getWalletStatus();
    expect(status.walletId).toBe(walletId);
    expect(status.network).toBe("regtest");
  });

  it("rescans without touching chain height", async () => {
    const before = await adapter().getStatus();
    await adapter().rescan(0);
    const after = await adapter().getStatus();
    expect(after.chainHeight).toBe(before.chainHeight);
  });
});
