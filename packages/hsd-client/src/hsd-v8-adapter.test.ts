import { afterEach, describe, expect, it, vi } from "vitest";
import { HsdV8Adapter, isSupportedHsdVersion } from "./hsd-v8-adapter.js";

describe("isSupportedHsdVersion", () => {
  it("accepts 8.x versions", () => {
    expect(isSupportedHsdVersion("8.0.0")).toBe(true);
    expect(isSupportedHsdVersion("8.9.3")).toBe(true);
  });

  it("rejects versions outside the 8.x range", () => {
    expect(isSupportedHsdVersion("7.0.0")).toBe(false);
    expect(isSupportedHsdVersion("9.0.0")).toBe(false);
  });
});

describe("HsdV8Adapter name queries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseName = {
    name: "natsuneko",
    nameHash: "2f6b4877478230254be0566cfef486d1da94c153a7c84b4da92d96c2d29e9ec",
    state: "CLOSED" as const,
    height: 93359,
    renewal: 339594,
    owner: { hash: "a".repeat(64), index: 0 },
    value: 0,
    highest: 0,
    transfer: 0,
    revoked: 0,
    claimed: 0,
    renewals: 1,
    registered: true,
    expired: false,
    weak: false,
    stats: { blocksUntilExpire: 105109, renewalPeriodEnd: 444714 },
  };

  const txtResourceHex = "0001000105610000"; // opaque stand-in; only .length is asserted on
  const decodedTxtResource = { records: [{ type: "TXT", txt: ["hello"] }] };

  function stubHttp(handlers: {
    wallet?: (path: string, body: unknown) => unknown;
    node?: (body: { method: string; params: unknown[] }) => unknown;
    nodeHttp?: (path: string) => unknown;
  }): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        if (url.startsWith("http://wallet")) {
          const path = url.replace("http://wallet", "");
          return new Response(JSON.stringify(handlers.wallet?.(path, body) ?? {}), { status: 200 });
        }
        if (url.startsWith("http://node")) {
          const path = url.replace("http://node", "");
          if (!body) {
            return new Response(
              JSON.stringify(
                handlers.nodeHttp?.(path) ?? {
                  version: "8.0.0",
                  network: "regtest",
                  chain: { height: 12, progress: 1 },
                  pool: { outbound: 0, inbound: 0 },
                },
              ),
              { status: 200 },
            );
          }
          const result = handlers.node?.(body as { method: string; params: unknown[] });
          return new Response(JSON.stringify({ result, error: null }), { status: 200 });
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );
  }

  function makeAdapter(): HsdV8Adapter {
    return new HsdV8Adapter({
      nodeUrl: "http://node",
      nodeApiKey: "key",
      walletUrl: "http://wallet",
      walletApiKey: "key",
      walletId: "primary",
    });
  }

  it("derives list ownership from the wallet UTXO set instead of global registration state", async () => {
    const wonOwner = { hash: "b".repeat(64), index: 1 };
    const lostOwner = { hash: "c".repeat(64), index: 2 };

    stubHttp({
      nodeHttp: () => ({
        version: "8.0.0",
        network: "regtest",
        chain: { height: 339606, progress: 1 },
        pool: { outbound: 0, inbound: 0 },
      }),
      wallet: (path) => {
        if (path === "/wallet/primary/name") {
          return [
            { ...baseName, name: "won-name", owner: wonOwner, data: "" },
            { ...baseName, name: "lost-name", owner: lostOwner, data: "" },
          ];
        }
        if (path === "/wallet/primary/coin") {
          return [
            { hash: wonOwner.hash, index: wonOwner.index, value: 1000, address: "hs1qowner" },
          ];
        }
        throw new Error(`unexpected wallet path ${path}`);
      },
    });

    const names = await makeAdapter().getNames();

    expect(names.find((name) => name.name === "won-name")).toMatchObject({
      state: "owned",
      owned: true,
      // The wallet's blocksUntilExpire is 105109 at height 339605. The node has already reached
      // the next block, so the displayed value must be derived from its current height instead.
      blocksRemaining: 105108,
    });
    expect(names.find((name) => name.name === "lost-name")).toMatchObject({
      state: "closed",
      owned: false,
    });
  });

  it("recovers a resource the wallet's own copy has lost, by trusting the node's namestate", () => {
    // Reproduces the reported bug: the wallet's `/auction/:name` reports an empty `data` (as
    // happens for names this wallet acquired via TRANSFER/FINALIZE without tracking their earlier
    // lifecycle — see hsd's wallet/txdb.js connectNames() FINALIZE branch, "Cannot get data or
    // highest") even though the name's resource is set and visible on-chain via the node.
    stubHttp({
      wallet: (path) => {
        if (path.startsWith("/wallet/primary/auction/")) {
          return { ...baseName, data: "", bids: [], reveals: [] };
        }
        if (path.startsWith("/wallet/primary/coin/")) {
          return { value: 1000, address: "hs1qowner" };
        }
        throw new Error(`unexpected wallet path ${path}`);
      },
      node: ({ method }) => {
        if (method === "getnameinfo") {
          return {
            start: { reserved: false, week: 0, start: 0 },
            info: { ...baseName, data: txtResourceHex },
          };
        }
        if (method === "getnameresource") return decodedTxtResource;
        throw new Error(`unexpected rpc ${method}`);
      },
    });

    return makeAdapter()
      .getName("natsuneko")
      .then((detail) => {
        expect(detail.resource).not.toBeNull();
        expect(detail.resource?.records).toEqual([{ type: "TXT", text: ["hello"] }]);
        expect(detail.resource?.raw).toBe(txtResourceHex);
      });
  });

  it("still reports no resource when neither the wallet nor the node has one", () => {
    stubHttp({
      wallet: (path) => {
        if (path.startsWith("/wallet/primary/auction/")) {
          return { ...baseName, data: "", bids: [], reveals: [] };
        }
        if (path.startsWith("/wallet/primary/coin/")) {
          return { value: 1000, address: "hs1qowner" };
        }
        throw new Error(`unexpected wallet path ${path}`);
      },
      node: ({ method }) => {
        if (method === "getnameinfo") {
          return {
            start: { reserved: false, week: 0, start: 0 },
            info: { ...baseName, data: "" },
          };
        }
        throw new Error(`unexpected rpc ${method}`);
      },
    });

    return makeAdapter()
      .getName("natsuneko")
      .then((detail) => {
        expect(detail.resource).toBeNull();
      });
  });

  it("does not show a registered later lifecycle as expired when hsd's wallet state is stale", async () => {
    // `expired` is retained by hsd after the first lifecycle expires. The wallet's historical
    // auction record may therefore still say CLOSED, while getnameinfo() reflects the new auction
    // lifecycle. A renewalPeriodEnd plus a matching wallet UTXO proves that the name is now
    // registered and owned, so the detail response must not retain the old Expired status.
    stubHttp({
      wallet: (path) => {
        if (path.startsWith("/wallet/primary/auction/")) {
          return { ...baseName, data: "", expired: true, bids: [], reveals: [] };
        }
        if (path.startsWith("/wallet/primary/coin/")) {
          return { value: 1000, address: "hs1qowner" };
        }
        throw new Error(`unexpected wallet path ${path}`);
      },
      node: ({ method }) => {
        if (method === "getnameinfo") {
          return {
            start: { reserved: false, week: 0, start: 0 },
            info: {
              ...baseName,
              data: "",
              state: "CLOSED",
              registered: false,
              expired: true,
              stats: { renewalPeriodEnd: 444206, blocksUntilExpire: 102660 },
            },
          };
        }
        throw new Error(`unexpected rpc ${method}`);
      },
    });

    await expect(makeAdapter().getName("natsuneko")).resolves.toMatchObject({
      state: "owned",
      owned: true,
    });
  });
});
