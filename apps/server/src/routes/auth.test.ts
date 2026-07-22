import { sql } from "drizzle-orm";
import { Secret, TOTP } from "otpauth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import type { Env } from "../env.js";
import { beginTotpEnrollment, confirmTotpEnrollment } from "../services/totp-service.js";

const env: Env = {
  APP_URL: "http://localhost:3000",
  HOST: "0.0.0.0",
  PORT: 3000,
  TRUST_PROXY: false,
  DATABASE_URL: ":memory:",
  HSD_NODE_URL: "http://hsd:12037",
  HSD_NODE_API_KEY: "node-key",
  HSD_WALLET_URL: "http://hsd:12039",
  HSD_WALLET_API_KEY: "wallet-key",
  HSD_WALLET_ID: "primary",
  HSD_NETWORK: "regtest",
  SESSION_SECRET: "x".repeat(32),
  ENCRYPTION_KEY: "y".repeat(32),
};

function fakeHsdManager() {
  const adapter = {
    getStatus: vi.fn(async () => ({})),
    getBalance: vi.fn(async () => ({})),
  };
  return { get: () => adapter, getConnection: vi.fn(), reconfigure: vi.fn() } as never;
}

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

function fakeStatusPoller() {
  return {
    getSnapshot: vi.fn(() => ({
      node: null,
      nodeError: null,
      walletConnected: false,
      walletError: null,
      lastUpdated: 0,
    })),
  } as never;
}

function buildApp() {
  return createApp(env, fakeHsdManager(), db, fakeStatusPoller());
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

async function getCsrfToken(app: ReturnType<typeof buildApp>, jar: Jar) {
  const res = await app.request("/api/auth/session", { headers: { cookie: jar.header() } });
  jar.absorb(res);
  const match = jar.header().match(/csrf_token=([^;]+)/);
  return match![1]!;
}

describe("auth routes end-to-end", () => {
  it("setup creates an admin and a live session", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await getCsrfToken(app, jar);

    const res = await app.request("/api/auth/setup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: jar.header(),
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ username: "alice", password: "correct-horse-battery-staple" }),
    });
    expect(res.status).toBe(200);
    jar.absorb(res);

    const session = await app.request("/api/auth/session", { headers: { cookie: jar.header() } });
    expect(await session.json()).toEqual({
      authenticated: true,
      setupComplete: true,
      pendingTotp: false,
      username: "alice",
      totpEnabled: false,
    });
  });

  it("refuses setup once an admin already exists", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await getCsrfToken(app, jar);

    await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ username: "alice", password: "correct-horse-battery-staple" }),
    });

    const second = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ username: "bob", password: "another-password-entirely" }),
    });
    expect(second.status).toBe(409);
  });

  it("logs in with username/password when TOTP is disabled", async () => {
    const app = buildApp();
    const jar = cookieJar();
    let csrf = await getCsrfToken(app, jar);
    const setupRes = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ username: "alice", password: "correct-horse-battery-staple" }),
    });
    jar.absorb(setupRes);

    // logout to prove login works from a clean slate
    await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: jar.header(), "x-csrf-token": csrf },
    });

    csrf = await getCsrfToken(app, jar);
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ username: "alice", password: "correct-horse-battery-staple" }),
    });
    expect(loginRes.status).toBe(200);
    expect(await loginRes.json()).toEqual({ totpRequired: false });
    jar.absorb(loginRes);

    const session = await app.request("/api/auth/session", { headers: { cookie: jar.header() } });
    expect((await readJson<{ authenticated: boolean }>(session)).authenticated).toBe(true);
  });

  it("locks out after repeated failed logins", async () => {
    const app = buildApp();
    const jar = cookieJar();
    let csrf = await getCsrfToken(app, jar);
    const setupRes = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ username: "alice", password: "correct-horse-battery-staple" }),
    });
    jar.absorb(setupRes);

    csrf = await getCsrfToken(app, jar);
    let last: Response | undefined;
    for (let i = 0; i < 5; i++) {
      last = await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.header(),
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({ username: "alice", password: "wrong-password" }),
      });
    }
    expect(last?.status).toBe(401);

    const lockedRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ username: "alice", password: "wrong-password" }),
    });
    expect(lockedRes.status).toBe(423);
  });

  it("requires TOTP as a second step when enabled, and finalizes the session on success", async () => {
    const app = buildApp();
    const jar = cookieJar();
    let csrf = await getCsrfToken(app, jar);
    const setupRes = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ username: "alice", password: "correct-horse-battery-staple" }),
    });
    jar.absorb(setupRes);

    const enrollment = await beginTotpEnrollment(db, env.ENCRYPTION_KEY);
    const totp = new TOTP({
      issuer: "Handshake Web Wallet",
      label: "alice",
      secret: Secret.fromBase32(enrollment.secret),
    });
    await confirmTotpEnrollment(db, env.ENCRYPTION_KEY, totp.generate());

    await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: jar.header(), "x-csrf-token": csrf },
    });

    csrf = await getCsrfToken(app, jar);
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ username: "alice", password: "correct-horse-battery-staple" }),
    });
    expect(await loginRes.json()).toEqual({ totpRequired: true });
    jar.absorb(loginRes);

    const notYetAuthed = await app.request("/api/auth/session", {
      headers: { cookie: jar.header() },
    });
    expect((await readJson<{ authenticated: boolean }>(notYetAuthed)).authenticated).toBe(false);

    const totpRes = await app.request("/api/auth/login/totp", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ code: totp.generate() }),
    });
    expect(totpRes.status).toBe(200);
    jar.absorb(totpRes);

    const authed = await app.request("/api/auth/session", { headers: { cookie: jar.header() } });
    expect((await readJson<{ authenticated: boolean }>(authed)).authenticated).toBe(true);
  });

  it("rejects writes without a CSRF token even when authenticated", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await getCsrfToken(app, jar);
    const setupRes = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
      body: JSON.stringify({ username: "alice", password: "correct-horse-battery-staple" }),
    });
    jar.absorb(setupRes);

    const res = await app.request("/api/auth/logout-all", {
      method: "POST",
      headers: { cookie: jar.header() },
    });
    expect(res.status).toBe(403);
  });
});

async function post(
  app: ReturnType<typeof buildApp>,
  jar: Jar,
  path: string,
  csrf: string,
  body?: unknown,
) {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: jar.header(), "x-csrf-token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.absorb(res);
  return res;
}

async function setUp(app: ReturnType<typeof buildApp>, jar: Jar) {
  const csrf = await getCsrfToken(app, jar);
  await post(app, jar, "/api/auth/setup", csrf, {
    username: "alice",
    password: "correct-horse-battery-staple",
  });
  return csrf;
}

describe("TOTP enrollment and reauth-gated operations", () => {
  it("enrolling and verifying TOTP returns recovery codes", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUp(app, jar);

    const enrollRes = await post(app, jar, "/api/auth/totp/enroll", csrf);
    expect(enrollRes.status).toBe(200);
    const enrollment = await readJson<{ secret: string; qrDataUrl: string }>(enrollRes);

    const totp = new TOTP({
      issuer: "Handshake Web Wallet",
      label: "alice",
      secret: Secret.fromBase32(enrollment.secret),
    });
    const verifyRes = await post(app, jar, "/api/auth/totp/verify", csrf, {
      code: totp.generate(),
    });
    expect(verifyRes.status).toBe(200);
    const body = await readJson<{ recoveryCodes: string[] }>(verifyRes);
    expect(body.recoveryCodes).toHaveLength(8);
  });

  it("blocks totp/disable until the session has reauthenticated", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUp(app, jar);

    // Simulate a stale session by clearing reauth server-side.
    db.run(sql`UPDATE sessions SET reauth_at = NULL`);

    const disableRes = await post(app, jar, "/api/auth/totp/disable", csrf);
    expect(disableRes.status).toBe(403);

    const reauthRes = await post(app, jar, "/api/auth/reauth", csrf, {
      method: "password",
      password: "correct-horse-battery-staple",
    });
    expect(reauthRes.status).toBe(200);

    const disableAfterReauth = await post(app, jar, "/api/auth/totp/disable", csrf);
    expect(disableAfterReauth.status).toBe(204);
  });

  it("rejects reauth with the wrong password", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUp(app, jar);
    db.run(sql`UPDATE sessions SET reauth_at = NULL`);

    const res = await post(app, jar, "/api/auth/reauth", csrf, {
      method: "password",
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
  });

  it("recovery/regen requires reauth and rotates the codes", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUp(app, jar);

    const enrollRes = await post(app, jar, "/api/auth/totp/enroll", csrf);
    const enrollment = await readJson<{ secret: string }>(enrollRes);
    const totp = new TOTP({
      issuer: "Handshake Web Wallet",
      label: "alice",
      secret: Secret.fromBase32(enrollment.secret),
    });
    await post(app, jar, "/api/auth/totp/verify", csrf, { code: totp.generate() });

    db.run(sql`UPDATE sessions SET reauth_at = NULL`);
    const blocked = await post(app, jar, "/api/auth/recovery/regen", csrf);
    expect(blocked.status).toBe(403);

    await post(app, jar, "/api/auth/reauth", csrf, {
      method: "password",
      password: "correct-horse-battery-staple",
    });
    const regenRes = await post(app, jar, "/api/auth/recovery/regen", csrf);
    expect(regenRes.status).toBe(200);
    const body = await readJson<{ recoveryCodes: string[] }>(regenRes);
    expect(body.recoveryCodes).toHaveLength(8);
  });
});
