import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { rateLimit } from "./rate-limit.js";

function buildApp(max: number, windowMs: number) {
  const app = new Hono();
  app.use(rateLimit({ max, windowMs }));
  app.get("/", (c) => c.text("ok"));
  return app;
}

describe("rateLimit", () => {
  it("allows requests up to the limit", async () => {
    const app = buildApp(3, 60_000);
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/");
      expect(res.status).toBe(200);
    }
  });

  it("rejects requests beyond the limit with 429 and Retry-After", async () => {
    const app = buildApp(2, 60_000);
    await app.request("/");
    await app.request("/");
    const res = await app.request("/");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
  });

  it("resets once the window elapses", async () => {
    const app = buildApp(1, 1_000);
    await app.request("/");
    expect((await app.request("/")).status).toBe(429);

    vi.useFakeTimers();
    vi.advanceTimersByTime(1_100);
    expect((await app.request("/")).status).toBe(200);
    vi.useRealTimers();
  });

  it("tracks separate clients independently when trustProxy reads X-Forwarded-For", async () => {
    const app = new Hono();
    app.use(rateLimit({ max: 1, windowMs: 60_000, trustProxy: true }));
    app.get("/", (c) => c.text("ok"));

    const resA1 = await app.request("/", { headers: { "x-forwarded-for": "203.0.113.1" } });
    const resA2 = await app.request("/", { headers: { "x-forwarded-for": "203.0.113.1" } });
    const resB1 = await app.request("/", { headers: { "x-forwarded-for": "203.0.113.2" } });

    expect(resA1.status).toBe(200);
    expect(resA2.status).toBe(429);
    expect(resB1.status).toBe(200);
  });
});
