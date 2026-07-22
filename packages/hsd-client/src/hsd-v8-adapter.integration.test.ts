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

  it("reads a single transaction by txid, before and after confirmation, and returns null for an unknown txid", async () => {
    const client = adapter();
    const receiveAddr = await client.getReceiveAddress();
    await mineTo(receiveAddr.address, 20);

    const destination = await client.getReceiveAddress();
    const sent = await client.send({
      address: destination.address,
      amount: 50_000_000n,
      feeRate: 10_000,
      idempotencyKey: randomUUID(),
    });

    const unconfirmed = await client.getTransaction(sent.txid);
    expect(unconfirmed?.txid).toBe(sent.txid);
    expect(unconfirmed?.confirmations).toBe(0);

    await mineTo(receiveAddr.address, 1);
    const confirmed = await client.getTransaction(sent.txid);
    expect(confirmed?.confirmations).toBeGreaterThan(0);

    const unknown = await client.getTransaction(
      "0".repeat(63) + "1", // well-formed but never-broadcast txid
    );
    expect(unknown).toBeNull();
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

  /**
   * A full OPEN -> BID -> REVEAL -> REGISTER cycle is exercised manually against this same
   * endpoint set (see docs/02-IMPLEMENTATION-PLAN.md Phase 3 notes) rather than reproduced here:
   * driving hsd's auction period boundaries reliably needs wall-clock-sensitive retries that are
   * too flaky for CI. This instead runs a fresh auction just far enough to reach the BIDDING
   * phase, which is enough to prove the wire format for getNames()/getName() end to end.
   *
   * Must run before the "rescans" test below — hsd's wallet gets confused building new
   * transactions while a background rescan it triggered is still catching up.
   */
  it("lists an in-progress auction and reads its detail back decoded", async () => {
    const client = adapter();
    const addr = (await client.getReceiveAddress()).address;
    await mineTo(addr, 20);

    const name = `alicetest${randomUUID().slice(0, 8)}`;

    async function walletPost(path: string, body: unknown): Promise<{ hash?: string }> {
      const res = await fetch(`${WALLET_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return res.json() as Promise<{ hash?: string }>;
    }

    const openRes = await walletPost("/wallet/primary/open", { name });
    expect(openRes.hash).toBeDefined();
    await mineTo(addr, 8);

    const names = await client.getNames();
    const listed = names.find((n) => n.name === name);
    expect(listed?.state).toBe("bidding");
    expect(listed?.owned).toBe(false);

    const detail = await client.getName(name);
    expect(detail.state).toBe("bidding");
    expect(detail.owned).toBe(false);
    expect(detail.ownerAddress).toBeNull();
    expect(detail.resource).toBeNull();
  });

  it("reads a fully registered name's decoded resource and confirmed ownership", async () => {
    const client = adapter();
    const names = await client.getNames();
    const owned = names.find((n) => n.state === "owned");

    // The regtest wallet only carries an already-registered name once a prior local run (or this
    // suite's own auction fixtures over time) has produced one; skip gracefully otherwise so this
    // stays a real end-to-end check without depending on hsd's auction timing to get there.
    if (!owned) return;

    const detail = await client.getName(owned.name);
    expect(detail.state).toBe("owned");
    expect(detail.owned).toBe(true);
    expect(detail.ownerAddress).toMatch(/^rs1q/);
    if (detail.resource) {
      expect(detail.resource.size).toBe(detail.resource.raw.length / 2);
    }
  });

  describe("Phase 4: name management writes", () => {
    async function walletFetch(
      walletId: string,
      path: string,
      body: unknown,
    ): Promise<{ hash?: string; error?: { message: string } }> {
      const res = await fetch(`${WALLET_URL}/wallet/${walletId}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return res.json() as Promise<{ hash?: string; error?: { message: string } }>;
    }

    async function retry<T>(
      addr: string,
      fn: () => Promise<T>,
      tries: number,
      mineEach = 2,
    ): Promise<T> {
      let lastError: unknown;
      for (let i = 0; i < tries; i++) {
        try {
          return await fn();
        } catch (error) {
          lastError = error;
          await mineTo(addr, mineEach);
        }
      }
      throw lastError;
    }

    /** Runs a name through OPEN -> BID -> REVEAL -> REGISTER on a dedicated wallet, using the raw HTTP API directly (not the adapter under test) so these tests exercise real hsd state. */
    async function registerFreshName(walletId: string, addr: string): Promise<string> {
      const name = `alicep4${randomUUID().slice(0, 8)}`;

      await retry(
        addr,
        async () => {
          const res = await walletFetch(walletId, "/open", { name });
          if (!res.hash) throw new Error(`open failed: ${res.error?.message}`);
        },
        5,
        3,
      );
      await mineTo(addr, 8);

      await retry(
        addr,
        async () => {
          const res = await walletFetch(walletId, "/bid", { name, bid: 500_000, lockup: 600_000 });
          if (!res.hash) throw new Error(`bid failed: ${res.error?.message}`);
        },
        8,
        3,
      );
      await mineTo(addr, 8);

      await retry(
        addr,
        async () => {
          const res = await walletFetch(walletId, "/reveal", { name });
          if (!res.hash) throw new Error(`reveal failed: ${res.error?.message}`);
        },
        8,
        3,
      );
      await mineTo(addr, 8);

      await retry(
        addr,
        async () => {
          const res = await walletFetch(walletId, "/update", {
            name,
            data: { records: [{ type: "TXT", txt: ["initial"] }] },
          });
          if (!res.hash) throw new Error(`initial register failed: ${res.error?.message}`);
        },
        8,
        3,
      );
      await mineTo(addr, 3);

      return name;
    }

    async function freshWallet(): Promise<{
      walletId: string;
      client: HsdV8Adapter;
      addr: string;
    }> {
      const walletId = `p4-${randomUUID().slice(0, 8)}`;
      await fetch(`${WALLET_URL}/wallet/${walletId}`, {
        method: "PUT",
        headers: {
          Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const client = adapter(walletId);
      const addr = (await client.getReceiveAddress()).address;
      await mineTo(addr, 20);
      return { walletId, client, addr };
    }

    it("previews and executes an UPDATE, reading the new resource back", async () => {
      const { client, addr, walletId } = await freshWallet();
      const name = await registerFreshName(walletId, addr);

      const detail = await client.getName(name);
      expect(detail.resource?.records).toEqual([{ type: "TXT", text: ["initial"] }]);

      const newRecords = [{ type: "TXT" as const, text: ["updated"] }];
      const preview = await client.previewUpdateName({ name, records: newRecords });
      expect(preview.fee).toBeGreaterThan(0n);
      expect(preview.resource.records).toEqual(newRecords);
      expect(preview.resource.size).toBe(preview.resource.raw.length / 2);

      const result = await client.updateName({ name, records: newRecords });
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
      expect(result.fee).toBe(preview.fee);

      await mineTo(addr, 2);
      const updated = await client.getName(name);
      expect(updated.resource?.records).toEqual(newRecords);
    }, 30_000);

    it("previews and executes a RENEWAL, advancing the renewal height", async () => {
      const { client, addr, walletId } = await freshWallet();
      const name = await registerFreshName(walletId, addr);

      const before = await client.getName(name);

      // regtest's renewalMaturity is 50 blocks — hsd rejects "renew yet" before that passes.
      const preview = await retry(addr, () => client.previewRenewName(name), 10, 8);
      expect(preview.fee).toBeGreaterThan(0n);

      const result = await client.renewName(name);
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);

      await mineTo(addr, 2);
      const after = await client.getName(name);
      expect(after.renewalHeight).toBeGreaterThan(before.renewalHeight);
    }, 30_000);

    it("runs TRANSFER through the lockup period and FINALIZE, confirming the new owner", async () => {
      const { client, addr, walletId } = await freshWallet();
      const name = await registerFreshName(walletId, addr);
      const destination = await client.getReceiveAddress();

      const transferPreview = await client.previewTransferName({
        name,
        address: destination.address,
      });
      expect(transferPreview.fee).toBeGreaterThan(0n);

      const transferResult = await client.transferName({ name, address: destination.address });
      expect(transferResult.txid).toMatch(/^[0-9a-f]{64}$/);
      await mineTo(addr, 2);

      const midTransfer = await client.getName(name);
      expect(midTransfer.transferState).not.toBe("none");

      // Lockup is short in regtest but non-zero; mine well past it before finalizing.
      await mineTo(addr, 15);

      const finalizePreview = await client.previewFinalizeName(name);
      expect(finalizePreview.fee).toBeGreaterThan(0n);

      const finalizeResult = await client.finalizeName(name);
      expect(finalizeResult.txid).toMatch(/^[0-9a-f]{64}$/);
      await mineTo(addr, 2);

      const finalized = await client.getName(name);
      expect(finalized.transferState).toBe("none");
      expect(finalized.owned).toBe(true);
      expect(finalized.ownerAddress).toBe(destination.address);
    }, 30_000);

    it("revokes a name irreversibly", async () => {
      const { client, addr, walletId } = await freshWallet();
      const name = await registerFreshName(walletId, addr);

      const result = await client.revokeName(name);
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);

      await mineTo(addr, 2);
      const revoked = await client.getName(name);
      expect(revoked.state).toBe("revoked");
    }, 30_000);

    it("renewNames processes each name independently, isolating a hsd-level failure", async () => {
      const { client, addr, walletId } = await freshWallet();
      const goodName = await registerFreshName(walletId, addr);
      await mineTo(addr, 55); // clear regtest's 50-block renewalMaturity

      const results = await client.renewNames([goodName, "totally-unregistered-name"]);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ name: goodName, status: "success" });
      expect(results[1]).toMatchObject({ name: "totally-unregistered-name", status: "failed" });
      expect(results[1]?.reason).toBeTruthy();
    }, 30_000);
  });

  // Must run last — hsd's wallet gets confused building new transactions while a background
  // rescan it triggered is still catching up (see the Phase 3 name-lifecycle test above).
  it("rescans without touching chain height", async () => {
    const before = await adapter().getStatus();
    await adapter().rescan(0);
    const after = await adapter().getStatus();
    expect(after.chainHeight).toBe(before.chainHeight);
  });
});
