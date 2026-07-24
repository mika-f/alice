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

describe("HsdV8Adapter.getName", () => {
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
});
