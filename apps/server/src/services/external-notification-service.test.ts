import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import {
  dispatchExternalNotification,
  getExternalNotificationSettings,
  sendTestNotification,
  setExternalNotificationSettings,
  toExternalNotificationStatus,
} from "./external-notification-service.js";

const ENCRYPTION_KEY = "y".repeat(32);

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("get/setExternalNotificationSettings", () => {
  it("returns disabled/empty defaults before any config is saved", () => {
    const settings = getExternalNotificationSettings(db, ENCRYPTION_KEY);
    expect(settings).toEqual({
      ntfy: { enabled: false, url: "" },
      discord: { enabled: false, url: "" },
    });
  });

  it("round-trips a saved config through encryption", () => {
    setExternalNotificationSettings(db, ENCRYPTION_KEY, {
      ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
      discord: { enabled: false, url: "" },
    });

    const settings = getExternalNotificationSettings(db, ENCRYPTION_KEY);
    expect(settings.ntfy).toEqual({ enabled: true, url: "https://ntfy.sh/my-topic" });
    expect(settings.discord).toEqual({ enabled: false, url: "" });
  });

  it("keeps the existing URL when a blank one is submitted (toggle without retyping)", () => {
    setExternalNotificationSettings(db, ENCRYPTION_KEY, {
      ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
      discord: { enabled: false, url: "" },
    });

    setExternalNotificationSettings(db, ENCRYPTION_KEY, {
      ntfy: { enabled: false, url: "" },
      discord: { enabled: false, url: "" },
    });

    const settings = getExternalNotificationSettings(db, ENCRYPTION_KEY);
    expect(settings.ntfy).toEqual({ enabled: false, url: "https://ntfy.sh/my-topic" });
  });

  it("cannot be decrypted with the wrong key, falling back to defaults", () => {
    setExternalNotificationSettings(db, ENCRYPTION_KEY, {
      ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
      discord: { enabled: false, url: "" },
    });

    const settings = getExternalNotificationSettings(db, "z".repeat(32));
    expect(settings.ntfy.enabled).toBe(false);
  });
});

describe("toExternalNotificationStatus", () => {
  it("never includes the raw URL, only whether one is configured", () => {
    const status = toExternalNotificationStatus({
      ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
      discord: { enabled: false, url: "" },
    });
    expect(status).toEqual({
      ntfy: { enabled: true, configured: true },
      discord: { enabled: false, configured: false },
    });
    expect(JSON.stringify(status)).not.toContain("ntfy.sh");
  });
});

describe("dispatchExternalNotification", () => {
  it("fans out to every enabled channel with the given message", async () => {
    setExternalNotificationSettings(db, ENCRYPTION_KEY, {
      ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
      discord: { enabled: true, url: "https://discord.com/api/webhooks/1/abc" },
    });

    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    dispatchExternalNotification(db, ENCRYPTION_KEY, "Node is unreachable: timeout");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    const [ntfyCall, discordCall] = fetchSpy.mock.calls;
    expect(ntfyCall?.[0]).toBe("https://ntfy.sh/my-topic");
    expect(ntfyCall?.[1]).toMatchObject({ method: "POST", body: "Node is unreachable: timeout" });

    expect(discordCall?.[0]).toBe("https://discord.com/api/webhooks/1/abc");
    const discordBody = JSON.parse(discordCall?.[1]?.body as string);
    expect(discordBody).toEqual({ content: "Node is unreachable: timeout" });
  });

  it("does nothing when no channel is enabled", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    dispatchExternalNotification(db, ENCRYPTION_KEY, "unused");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("swallows a failed send instead of throwing", async () => {
    setExternalNotificationSettings(db, ENCRYPTION_KEY, {
      ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
      discord: { enabled: false, url: "" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    expect(() => dispatchExternalNotification(db, ENCRYPTION_KEY, "hello")).not.toThrow();
  });
});

describe("sendTestNotification", () => {
  it("reports per-channel success and awaits the result", async () => {
    setExternalNotificationSettings(db, ENCRYPTION_KEY, {
      ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
      discord: { enabled: true, url: "https://discord.com/api/webhooks/1/abc" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    const result = await sendTestNotification(db, ENCRYPTION_KEY);
    expect(result).toEqual({ ntfy: true, discord: true });
  });

  it("reports false for a channel that fails", async () => {
    setExternalNotificationSettings(db, ENCRYPTION_KEY, {
      ntfy: { enabled: true, url: "https://ntfy.sh/my-topic" },
      discord: { enabled: false, url: "" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await sendTestNotification(db, ENCRYPTION_KEY);
    expect(result).toEqual({ ntfy: false, discord: null });
  });
});
