import { randomUUID } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import type { Env } from "../env.js";
import { HsdConnectionManager } from "../services/hsd-connection-manager.js";
import { RescanTracker } from "../services/rescan-tracker.js";
import { StatusPoller } from "../services/status-poller.js";

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

const env: Env = {
  APP_URL: "http://localhost:3000",
  HOST: "0.0.0.0",
  PORT: 3000,
  TRUST_PROXY: false,
  DATABASE_URL: ":memory:",
  HSD_NODE_URL: NODE_URL,
  HSD_NODE_API_KEY: API_KEY,
  HSD_WALLET_URL: WALLET_URL,
  HSD_WALLET_API_KEY: API_KEY,
  HSD_WALLET_ID: "primary",
  HSD_NETWORK: "regtest",
  SESSION_SECRET: "x".repeat(32),
  ENCRYPTION_KEY: "y".repeat(32),
};

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

function buildApp(customEnv: Env = env) {
  const hsdManager = HsdConnectionManager.fromEnvOrDb(db, customEnv);
  return createApp(customEnv, hsdManager, db, new StatusPoller(hsdManager), new RescanTracker());
}

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

async function walletFetch(
  walletId: string,
  path: string,
  body: unknown,
): Promise<{ hash?: string; address?: string; error?: { message: string } }> {
  const res = await fetch(`${WALLET_URL}/wallet/${walletId}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ hash?: string; address?: string; error?: { message: string } }>;
}

async function walletBalance(walletId: string): Promise<{ confirmed: number }> {
  const res = await fetch(`${WALLET_URL}/wallet/${walletId}/balance`, {
    headers: { Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}` },
  });
  return res.json() as Promise<{ confirmed: number }>;
}

/** Polls a freshly created wallet until its DB has caught up enough to see the funds it was just mined. */
async function waitForWalletFunds(walletId: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const balance = await walletBalance(walletId);
    if (balance.confirmed > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function retry<T>(
  addr: string,
  fn: () => Promise<T>,
  tries: number,
  mineEach = 3,
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

/** Creates a dedicated wallet, funds it, and registers a fresh name through OPEN -> BID -> REVEAL -> REGISTER via the raw HTTP API (not the routes under test). */
async function setUpFreshOwnedName(): Promise<{
  walletId: string;
  addr: string;
  name: string;
  env: Env;
}> {
  const walletId = `p4route-${randomUUID().slice(0, 8)}`;
  await fetch(`${WALLET_URL}/wallet/${walletId}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const addrRes = await walletFetch(walletId, "/address", { account: "default" });
  const addr = addrRes.address!;
  await mineTo(addr, 20);

  // A freshly created wallet's DB can lag a moment behind the chain tip it was just funded on;
  // wait for it to catch up rather than let the very first /open attempt race that (this shows up
  // as a spurious "Name is already opening" from hsd, not a funds/timing error it reports clearly).
  await waitForWalletFunds(walletId);

  const name = `aliceroute${randomUUID().slice(0, 8)}`;

  await retry(
    addr,
    async () => {
      const res = await walletFetch(walletId, "/open", { name });
      if (!res.hash) throw new Error(`open failed: ${res.error?.message}`);
    },
    5,
  );
  await mineTo(addr, 8);

  await retry(
    addr,
    async () => {
      const res = await walletFetch(walletId, "/bid", { name, bid: 500_000, lockup: 600_000 });
      if (!res.hash) throw new Error(`bid failed: ${res.error?.message}`);
    },
    8,
  );
  await mineTo(addr, 8);

  await retry(
    addr,
    async () => {
      const res = await walletFetch(walletId, "/reveal", { name });
      if (!res.hash) throw new Error(`reveal failed: ${res.error?.message}`);
    },
    8,
  );
  await mineTo(addr, 8);

  await retry(
    addr,
    async () => {
      const res = await walletFetch(walletId, "/update", {
        name,
        data: { records: [{ type: "TXT", txt: ["initial"] }] },
      });
      if (!res.hash) throw new Error(`register failed: ${res.error?.message}`);
    },
    8,
  );
  await mineTo(addr, 3);

  return { walletId, addr, name, env: { ...env, HSD_WALLET_ID: walletId } };
}

interface Jar {
  header(): string;
  absorb(res: Response): void;
}

function cookieJar(): Jar {
  const cookies = new Map<string, string>();
  return {
    header() {
      return Array.from(cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
    absorb(res: Response) {
      for (const setCookie of res.headers.getSetCookie?.() ?? []) {
        const [pair] = setCookie.split(";");
        const [name, value] = pair!.split("=");
        if (name && value !== undefined) cookies.set(name, value);
      }
    },
  };
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function req(
  app: ReturnType<typeof buildApp>,
  jar: Jar,
  method: string,
  path: string,
  csrf: string,
  body?: unknown,
) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.absorb(res);
  return res;
}

async function setUpAndLogIn(app: ReturnType<typeof buildApp>, jar: Jar) {
  const first = await app.request("/api/auth/session", { headers: { cookie: jar.header() } });
  jar.absorb(first);
  const csrf = jar.header().match(/csrf_token=([^;]+)/)![1]!;

  await req(app, jar, "POST", "/api/auth/setup", csrf, {
    username: "alice",
    password: "correct-horse-battery-staple",
  });

  return csrf;
}

function currentTotpCode(secretBase32: string): string {
  const totp = new TOTP({
    issuer: "Handshake Web Wallet",
    label: "alice",
    secret: Secret.fromBase32(secretBase32),
  });
  return totp.generate();
}

async function enrollTotp(
  app: ReturnType<typeof buildApp>,
  jar: Jar,
  csrf: string,
): Promise<string> {
  const enrollRes = await req(app, jar, "POST", "/api/auth/totp/enroll", csrf);
  const { secret } = await readJson<{ secret: string }>(enrollRes);

  await req(app, jar, "POST", "/api/auth/totp/verify", csrf, { code: currentTotpCode(secret) });
  return secret;
}

describe.skipIf(!available)("name routes against a live regtest hsd", () => {
  it("lists names known to the wallet", async () => {
    const app = buildApp();
    const jar = cookieJar();
    await setUpAndLogIn(app, jar);

    const res = await app.request("/api/names", { headers: { cookie: jar.header() } });
    expect(res.status).toBe(200);
    const names = await readJson<{ name: string; state: string }[]>(res);
    expect(Array.isArray(names)).toBe(true);
  });

  it("reads a name's detail and lets a local label/memo be attached", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const names = await readJson<{ name: string; state: string }[]>(
      await app.request("/api/names", { headers: { cookie: jar.header() } }),
    );
    // "primary" accumulates real names from Phase 3 dev/testing against this long-running
    // regtest stack; skip gracefully on a completely fresh stack instead of asserting one exists.
    if (names.length === 0) return;

    const target = names[0]!;

    const detailRes = await app.request(`/api/names/${target.name}`, {
      headers: { cookie: jar.header() },
    });
    expect(detailRes.status).toBe(200);
    const detail = await readJson<{ name: string; nameHash: string; bids: unknown[] }>(detailRes);
    expect(detail.name).toBe(target.name);
    expect(typeof detail.nameHash).toBe("string");
    expect(Array.isArray(detail.bids)).toBe(true);

    const metaRes = await req(app, jar, "PUT", `/api/names/${target.name}/meta`, csrf, {
      label: "Integration test label",
    });
    expect(metaRes.status).toBe(204);

    const relistedRes = await app.request("/api/names", { headers: { cookie: jar.header() } });
    const relisted = await readJson<{ name: string; label?: string }[]>(relistedRes);
    expect(relisted.find((n) => n.name === target.name)?.label).toBe("Integration test label");
  });

  it("returns the decoded resource for a name via the dedicated endpoint", async () => {
    const app = buildApp();
    const jar = cookieJar();
    await setUpAndLogIn(app, jar);

    const names = await readJson<{ name: string; resourceSummary: string | null }[]>(
      await app.request("/api/names", { headers: { cookie: jar.header() } }),
    );
    const withResource = names.find((n) => n.resourceSummary !== null);
    if (!withResource) return;

    const res = await app.request(`/api/names/${withResource.name}/resource`, {
      headers: { cookie: jar.header() },
    });
    expect(res.status).toBe(200);
    const resource = await readJson<{ records: unknown[]; raw: string; size: number } | null>(res);
    expect(resource).not.toBeNull();
    expect(Array.isArray(resource?.records)).toBe(true);
  });

  it("previews and executes an UPDATE through the full HTTP route, rejecting an invalid resource first", async () => {
    const { name, env: walletEnv } = await setUpFreshOwnedName();
    const app = buildApp(walletEnv);
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const invalidRes = await req(app, jar, "POST", `/api/names/${name}/update/preview`, csrf, {
      records: [{ type: "NS", ns: "not-a-valid-hostname" }],
    });
    expect(invalidRes.status).toBe(400);
    const invalidBody = await readJson<{ issues: { code: string }[] }>(invalidRes);
    expect(invalidBody.issues.some((i) => i.code === "ns-hostname-invalid")).toBe(true);

    const records = [{ type: "TXT", text: ["route-test"] }];
    const previewRes = await req(app, jar, "POST", `/api/names/${name}/update/preview`, csrf, {
      records,
    });
    expect(previewRes.status).toBe(200);
    const preview = await readJson<{ fee: string; resource: { raw: string; size: number } }>(
      previewRes,
    );
    expect(BigInt(preview.fee)).toBeGreaterThan(0n);
    expect(preview.resource.size).toBe(preview.resource.raw.length / 2);

    const updateRes = await req(app, jar, "POST", `/api/names/${name}/update`, csrf, { records });
    expect(updateRes.status).toBe(200);
    const updated = await readJson<{ txid: string }>(updateRes);
    expect(updated.txid).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);

  it("runs a batch renewal reporting per-name success and skip results", async () => {
    const { name, env: walletEnv } = await setUpFreshOwnedName();
    const app = buildApp(walletEnv);
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const res = await req(app, jar, "POST", "/api/names/renew-batch", csrf, {
      names: [name, "totally-unregistered-name"],
    });
    expect(res.status).toBe(200);
    const results = await readJson<{ name: string; status: string; reason?: string }[]>(res);

    // The freshly-registered name hasn't cleared regtest's 50-block renewalMaturity yet, so hsd
    // rejects it — the important thing this route test is checking is that the *unrelated* bad
    // name doesn't abort the whole batch, and that a real per-name outcome comes back for both.
    expect(results.find((r) => r.name === name)).toBeDefined();
    const unregistered = results.find((r) => r.name === "totally-unregistered-name");
    expect(unregistered?.status).toBe("skipped");
    expect(unregistered?.reason).toBe("Renewal not available");
  }, 30_000);

  it("rejects revoke with 403 until TOTP is enabled, even with reauth satisfied", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const res = await req(app, jar, "POST", "/api/names/whatever/revoke", csrf, {
      password: "correct-horse-battery-staple",
      code: "000000",
    });
    expect(res.status).toBe(403);
  });

  it("revokes a name only once both password and a fresh TOTP code are supplied", async () => {
    const { name, env: walletEnv } = await setUpFreshOwnedName();
    const app = buildApp(walletEnv);
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);
    const secret = await enrollTotp(app, jar, csrf);

    const wrongPasswordRes = await req(app, jar, "POST", `/api/names/${name}/revoke`, csrf, {
      password: "wrong-password",
      code: currentTotpCode(secret),
    });
    expect(wrongPasswordRes.status).toBe(401);

    const res = await req(app, jar, "POST", `/api/names/${name}/revoke`, csrf, {
      password: "correct-horse-battery-staple",
      code: currentTotpCode(secret),
    });
    expect(res.status).toBe(200);
    const result = await readJson<{ txid: string }>(res);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);
});
