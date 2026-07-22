import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import type { Env } from "../env.js";
import { createNotification } from "../services/notification-service.js";
import { RescanTracker } from "../services/rescan-tracker.js";

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
  return { get: () => ({}), getConnection: vi.fn(), reconfigure: vi.fn() } as never;
}

function fakeStatusPoller() {
  return { getSnapshot: vi.fn() } as never;
}

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

function buildApp() {
  return createApp(env, fakeHsdManager(), db, fakeStatusPoller(), new RescanTracker());
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

describe("notification routes", () => {
  it("lists notifications newest first", async () => {
    createNotification(db, { type: "node-disconnected", message: "first" });
    createNotification(db, { type: "wallet-disconnected", message: "second" });

    const app = buildApp();
    const jar = cookieJar();
    await setUpAndLogIn(app, jar);

    const res = await app.request("/api/notifications", { headers: { cookie: jar.header() } });
    expect(res.status).toBe(200);
    const notifications = (await res.json()) as { message: string; readAt: number | null }[];
    expect(notifications.map((n) => n.message)).toEqual(["second", "first"]);
    expect(notifications.every((n) => n.readAt === null)).toBe(true);
  });

  it("marks a notification read", async () => {
    createNotification(db, { type: "node-disconnected", message: "first" });

    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const list = (await (
      await app.request("/api/notifications", { headers: { cookie: jar.header() } })
    ).json()) as { id: number }[];
    const id = list[0]!.id;

    const readRes = await req(app, jar, "POST", `/api/notifications/${id}/read`, csrf);
    expect(readRes.status).toBe(204);

    const relisted = (await (
      await app.request("/api/notifications", { headers: { cookie: jar.header() } })
    ).json()) as { id: number; readAt: number | null }[];
    expect(relisted.find((n) => n.id === id)?.readAt).not.toBeNull();
  });

  it("gets default thresholds and lets them be updated", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const defaultsRes = await app.request("/api/settings/notifications", {
      headers: { cookie: jar.header() },
    });
    expect(defaultsRes.status).toBe(200);
    const defaults = (await defaultsRes.json()) as { blocksRemaining: number };
    expect(defaults.blocksRemaining).toBeGreaterThan(0);

    const putRes = await req(app, jar, "PUT", "/api/settings/notifications", csrf, {
      blocksRemaining: 1000,
      daysRemaining: 7,
      expirationRatio: 0.05,
    });
    expect(putRes.status).toBe(204);

    const updatedRes = await app.request("/api/settings/notifications", {
      headers: { cookie: jar.header() },
    });
    const updated = (await updatedRes.json()) as { blocksRemaining: number };
    expect(updated.blocksRemaining).toBe(1000);
  });

  it("rejects invalid threshold values", async () => {
    const app = buildApp();
    const jar = cookieJar();
    const csrf = await setUpAndLogIn(app, jar);

    const res = await req(app, jar, "PUT", "/api/settings/notifications", csrf, {
      blocksRemaining: -1,
      daysRemaining: 7,
      expirationRatio: 0.05,
    });
    expect(res.status).toBe(400);
  });

  describe("external notifications (spec §20.2)", () => {
    it("reports disabled/unconfigured channels by default, never leaking a URL", async () => {
      const app = buildApp();
      const jar = cookieJar();
      await setUpAndLogIn(app, jar);

      const res = await app.request("/api/settings/external-notifications", {
        headers: { cookie: jar.header() },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ntfy: { enabled: false, configured: false },
        discord: { enabled: false, configured: false },
      });
    });

    it("saves a channel config and the GET response never echoes the URL back", async () => {
      const app = buildApp();
      const jar = cookieJar();
      const csrf = await setUpAndLogIn(app, jar);

      const putRes = await req(app, jar, "PUT", "/api/settings/external-notifications", csrf, {
        ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
        discord: { enabled: false, url: "" },
      });
      expect(putRes.status).toBe(200);
      const body = JSON.stringify(await putRes.json());
      expect(body).not.toContain("ntfy.sh");

      const getRes = await app.request("/api/settings/external-notifications", {
        headers: { cookie: jar.header() },
      });
      expect(await getRes.json()).toEqual({
        ntfy: { enabled: true, configured: true },
        discord: { enabled: false, configured: false },
      });
    });

    it("rejects enabling a channel with no URL and none previously configured", async () => {
      const app = buildApp();
      const jar = cookieJar();
      const csrf = await setUpAndLogIn(app, jar);

      const res = await req(app, jar, "PUT", "/api/settings/external-notifications", csrf, {
        ntfy: { enabled: true, url: "" },
        discord: { enabled: false, url: "" },
      });
      expect(res.status).toBe(400);
    });

    it("keeps a previously configured URL when toggling enabled with a blank URL", async () => {
      const app = buildApp();
      const jar = cookieJar();
      const csrf = await setUpAndLogIn(app, jar);

      await req(app, jar, "PUT", "/api/settings/external-notifications", csrf, {
        ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
        discord: { enabled: false, url: "" },
      });

      const disableRes = await req(app, jar, "PUT", "/api/settings/external-notifications", csrf, {
        ntfy: { enabled: false, url: "" },
        discord: { enabled: false, url: "" },
      });
      expect(disableRes.status).toBe(200);

      const reenableRes = await req(app, jar, "PUT", "/api/settings/external-notifications", csrf, {
        ntfy: { enabled: true, url: "" },
        discord: { enabled: false, url: "" },
      });
      expect(reenableRes.status).toBe(200);
      expect(await reenableRes.json()).toEqual({
        ntfy: { enabled: true, configured: true },
        discord: { enabled: false, configured: false },
      });
    });

    it("records the settings change in the audit log", async () => {
      const app = buildApp();
      const jar = cookieJar();
      const csrf = await setUpAndLogIn(app, jar);

      await req(app, jar, "PUT", "/api/settings/external-notifications", csrf, {
        ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
        discord: { enabled: false, url: "" },
      });

      const auditRes = await app.request("/api/audit-log", { headers: { cookie: jar.header() } });
      const entries = (await auditRes.json()) as { action: string }[];
      expect(entries.some((e) => e.action === "settings.external_notifications")).toBe(true);
    });
  });
});
