import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import type { Env } from "../env.js";
import { listWatchedBroadcasts } from "../services/broadcast-watch-service.js";
import { HsdConnectionManager } from "../services/hsd-connection-manager.js";
import { listNotifications } from "../services/notification-service.js";
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

async function nodeRpc(method: string, params: unknown[] = []): Promise<void> {
  const res = await fetch(NODE_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`:${API_KEY}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ method, params }),
  });
  const body = (await res.json()) as { error: unknown };
  if (body.error) throw new Error(`RPC ${method} failed: ${JSON.stringify(body.error)}`);
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

function buildApp() {
  const hsdManager = HsdConnectionManager.fromEnvOrDb(db, env);
  return createApp(env, hsdManager, db, new StatusPoller(hsdManager), new RescanTracker());
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

describe.skipIf(!available)("wallet routes against a live regtest hsd", () => {
  it("issues a receive address and lists it in address history", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const res = await req(app, jar, "POST", "/api/wallet/receive-address", csrf);
    expect(res.status).toBe(200);
    const address = await readJson<{ address: string }>(res);

    const listRes = await app.request("/api/wallet/addresses", {
      headers: { cookie: jar.header() },
    });
    const list = await readJson<{ address: string }[]>(listRes);
    expect(list.some((entry) => entry.address === address.address)).toBe(true);
  });

  it("labels an address", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const issued = await readJson<{ address: string }>(
      await req(app, jar, "POST", "/api/wallet/receive-address", csrf),
    );

    const labelRes = await req(
      app,
      jar,
      "PUT",
      `/api/wallet/addresses/${issued.address}/meta`,
      csrf,
      { label: "Savings" },
    );
    expect(labelRes.status).toBe(204);

    const list = await readJson<{ address: string; label: string | null }[]>(
      await app.request("/api/wallet/addresses", { headers: { cookie: jar.header() } }),
    );
    expect(list.find((entry) => entry.address === issued.address)?.label).toBe("Savings");
  });

  it("mines, estimates, sends, and reports the tx in history with a label", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const receive = await readJson<{ address: string }>(
      await req(app, jar, "POST", "/api/wallet/receive-address", csrf),
    );
    await nodeRpc("generatetoaddress", [20, receive.address]);

    const balanceRes = await app.request("/api/wallet/balance", {
      headers: { cookie: jar.header() },
    });
    const balance = await readJson<{ confirmed: string }>(balanceRes);
    expect(BigInt(balance.confirmed)).toBeGreaterThan(0n);

    const destination = await readJson<{ address: string }>(
      await req(app, jar, "POST", "/api/wallet/receive-address", csrf),
    );

    const estimateRes = await req(app, jar, "POST", "/api/wallet/send/estimate", csrf, {
      address: destination.address,
      amount: "100000000",
      feeRate: 10_000,
      idempotencyKey: randomUUID(),
    });
    expect(estimateRes.status).toBe(200);
    const estimate = await readJson<{ fee: string }>(estimateRes);
    expect(BigInt(estimate.fee)).toBeGreaterThan(0n);

    const sendRes = await req(app, jar, "POST", "/api/wallet/send", csrf, {
      address: destination.address,
      amount: "100000000",
      feeRate: 10_000,
      idempotencyKey: randomUUID(),
      label: "Test payment",
    });
    expect(sendRes.status).toBe(200);
    const sent = await readJson<{ txid: string }>(sendRes);

    await nodeRpc("generatetoaddress", [1, receive.address]);

    const historyRes = await app.request("/api/wallet/transactions?limit=5", {
      headers: { cookie: jar.header() },
    });
    const history = await readJson<{ items: { txid: string; label?: string }[] }>(historyRes);
    const found = history.items.find((item) => item.txid === sent.txid);
    expect(found?.label).toBe("Test payment");
  });

  it("replays a repeated idempotency key instead of sending twice", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const receive = await readJson<{ address: string }>(
      await req(app, jar, "POST", "/api/wallet/receive-address", csrf),
    );
    await nodeRpc("generatetoaddress", [20, receive.address]);

    const destination = await readJson<{ address: string }>(
      await req(app, jar, "POST", "/api/wallet/receive-address", csrf),
    );
    const idempotencyKey = randomUUID();
    const body = {
      address: destination.address,
      amount: "50000000",
      feeRate: 10_000,
      idempotencyKey,
    };

    const first = await readJson<{ txid: string }>(
      await req(app, jar, "POST", "/api/wallet/send", csrf, body),
    );
    const second = await readJson<{ txid: string }>(
      await req(app, jar, "POST", "/api/wallet/send", csrf, body),
    );
    expect(second.txid).toBe(first.txid);
  });

  it("rejects a send without reauth even when logged in", async () => {
    const app = buildApp();
    const jar = cookieJar();
    await setUpAndLogIn(app, jar);
    const csrf = jar.header().match(/csrf_token=([^;]+)/)![1]!;

    // Simulate a stale session by clearing reauth server-side
    // (setUpAndLogIn's own setup call marks reauth immediately, so force it stale).
    db.run(sql`UPDATE sessions SET reauth_at = NULL`);

    const res = await req(app, jar, "POST", "/api/wallet/send", csrf, {
      address: "rs1qdoesnotmatter",
      amount: "1",
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(403);
  });

  it("locks and unlocks the wallet via the API", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const lockRes = await req(app, jar, "POST", "/api/wallet/lock", csrf);
    expect(lockRes.status).toBe(204);

    // "primary" has no passphrase, so unlock against it fails — exercise the error path.
    const unlockRes = await req(app, jar, "POST", "/api/wallet/unlock", csrf, {
      passphrase: "whatever",
      timeoutSeconds: 60,
    });
    expect([200, 204, 401]).toContain(unlockRes.status);
  });

  it("records both a rejected and a successful send in the audit log", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    // Stale reauth: this attempt is rejected downstream by requireReauth(), but the
    // audit middleware runs first and must still record the attempt as a failure.
    db.run(sql`UPDATE sessions SET reauth_at = NULL`);
    const rejected = await req(app, jar, "POST", "/api/wallet/send", csrf, {
      address: "rs1qdoesnotmatter",
      amount: "1",
      idempotencyKey: randomUUID(),
    });
    expect(rejected.status).toBe(403);

    // Re-establish reauth (setup already satisfied the password factor once) and send for real.
    db.run(sql`UPDATE sessions SET reauth_at = unixepoch()`);
    const receive = await readJson<{ address: string }>(
      await req(app, jar, "POST", "/api/wallet/receive-address", csrf),
    );
    await nodeRpc("generatetoaddress", [20, receive.address]);
    const destination = await readJson<{ address: string }>(
      await req(app, jar, "POST", "/api/wallet/receive-address", csrf),
    );
    const sendRes = await req(app, jar, "POST", "/api/wallet/send", csrf, {
      address: destination.address,
      amount: "50000000",
      feeRate: 10_000,
      idempotencyKey: randomUUID(),
    });
    expect(sendRes.status).toBe(200);

    const auditRes = await app.request("/api/audit-log", { headers: { cookie: jar.header() } });
    const entries = await readJson<{ action: string; outcome: string }[]>(auditRes);
    const sendEntries = entries.filter((e) => e.action === "wallet.send");
    expect(sendEntries.some((e) => e.outcome === "failure")).toBe(true);
    expect(sendEntries.some((e) => e.outcome === "success")).toBe(true);
  });

  it("watches a real send, then notifies tx-confirmed once the status poller sees it mined", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const receive = await readJson<{ address: string }>(
      await req(app, jar, "POST", "/api/wallet/receive-address", csrf),
    );
    await nodeRpc("generatetoaddress", [20, receive.address]);
    const destination = await readJson<{ address: string }>(
      await req(app, jar, "POST", "/api/wallet/receive-address", csrf),
    );

    const sendRes = await req(app, jar, "POST", "/api/wallet/send", csrf, {
      address: destination.address,
      amount: "50000000",
      feeRate: 10_000,
      idempotencyKey: randomUUID(),
    });
    expect(sendRes.status).toBe(200);
    const sent = await readJson<{ txid: string }>(sendRes);

    expect(listWatchedBroadcasts(db).some((w) => w.txid === sent.txid)).toBe(true);

    await nodeRpc("generatetoaddress", [1, receive.address]);

    const hsdManager = HsdConnectionManager.fromEnvOrDb(db, env);
    const poller = new StatusPoller(hsdManager, db);
    await poller.refresh();

    expect(
      listNotifications(db).some((n) => n.type === "tx-confirmed" && n.message.includes(sent.txid)),
    ).toBe(true);
    expect(listWatchedBroadcasts(db).some((w) => w.txid === sent.txid)).toBe(false);
  });

  it("flags a stale backup on the dashboard status and clears it once confirmed", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const statusRes = await app.request("/api/status", { headers: { cookie: jar.header() } });
    const status = await readJson<{ warnings: { type: string }[] }>(statusRes);
    expect(status.warnings.some((w) => w.type === "backup-stale")).toBe(true);

    const confirmRes = await req(app, jar, "POST", "/api/settings/backup/confirm", csrf);
    expect(confirmRes.status).toBe(200);

    const statusAfter = await app.request("/api/status", { headers: { cookie: jar.header() } });
    const after = await readJson<{ warnings: { type: string }[] }>(statusAfter);
    expect(after.warnings.some((w) => w.type === "backup-stale")).toBe(false);
  });

  it("imports a wallet from a mnemonic", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const walletId = `mnemonic-${randomUUID().slice(0, 8)}`;
    const res = await req(app, jar, "POST", "/api/wallet/import/mnemonic", csrf, {
      walletId,
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    });
    expect(res.status).toBe(204);
  });
});
