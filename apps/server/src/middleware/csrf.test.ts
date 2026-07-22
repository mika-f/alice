import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { CSRF_COOKIE, CSRF_HEADER, ensureCsrfCookie, verifyCsrf } from "./csrf.js";

const env = { APP_URL: "https://wallet.example.com" } as Env;

function buildApp() {
  const app = new Hono();
  app.use(ensureCsrfCookie());
  app.use(verifyCsrf(env));
  app.get("/token", (c) => c.text("ok"));
  app.post("/write", (c) => c.text("done"));
  return app;
}

function extractCookie(res: Response, name: string): string | undefined {
  const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1];
  }
  return undefined;
}

describe("CSRF middleware", () => {
  it("issues a token cookie on GET and does not block safe methods", async () => {
    const app = buildApp();
    const res = await app.request("/token");
    expect(res.status).toBe(200);
    expect(extractCookie(res, CSRF_COOKIE)).toBeDefined();
  });

  it("rejects a write with no CSRF token at all", async () => {
    const app = buildApp();
    const res = await app.request("/write", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("accepts a write when the cookie and header match", async () => {
    const app = buildApp();
    const tokenRes = await app.request("/token");
    const token = extractCookie(tokenRes, CSRF_COOKIE);
    expect(token).toBeDefined();

    const res = await app.request("/write", {
      method: "POST",
      headers: { cookie: `${CSRF_COOKIE}=${token}`, [CSRF_HEADER]: token! },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a write when the header token doesn't match the cookie", async () => {
    const app = buildApp();
    const res = await app.request("/write", {
      method: "POST",
      headers: { cookie: `${CSRF_COOKIE}=real-token`, [CSRF_HEADER]: "forged-token" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a cross-site request signaled by Sec-Fetch-Site", async () => {
    const app = buildApp();
    const res = await app.request("/write", {
      method: "POST",
      headers: {
        cookie: `${CSRF_COOKIE}=real-token`,
        [CSRF_HEADER]: "real-token",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a mismatched Origin header even with matching tokens", async () => {
    const app = buildApp();
    const res = await app.request("https://wallet.example.com/write", {
      method: "POST",
      headers: {
        cookie: `${CSRF_COOKIE}=real-token`,
        [CSRF_HEADER]: "real-token",
        origin: "https://evil.example.com",
      },
    });
    expect(res.status).toBe(403);
  });

  it("accepts a request whose Origin matches APP_URL even though the request itself arrived as plain http (reverse proxy terminating TLS, e.g. Traefik)", async () => {
    const app = buildApp();
    const res = await app.request("http://internal-container:3000/write", {
      method: "POST",
      headers: {
        cookie: `${CSRF_COOKIE}=real-token`,
        [CSRF_HEADER]: "real-token",
        origin: "https://wallet.example.com",
      },
    });
    expect(res.status).toBe(200);
  });
});
