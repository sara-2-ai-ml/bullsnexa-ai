import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type BuildAppOptions } from "../src/app.js";
import { DemoAuth, readCookie } from "../src/http/auth.js";
import { FixedWindowRateLimiter } from "../src/http/rate-limit.js";
import { createRunStore } from "../src/persistence/run-store.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const brief = {
  campaignName: "Synthetic Spring Launch",
  objective: "sales",
  targetAudience: "Synthetic retail audience",
  targetCountry: "US",
  channels: ["search", "social"],
  budgetAmount: 25_000,
  currency: "USD",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  targetKpi: { metric: "purchases", targetValue: 500 },
  category: "retail",
};

function appWith(options: BuildAppOptions = {}) {
  const app = buildApp({ today: () => "2026-01-15", ...options });
  apps.push(app);
  return app;
}

describe("FixedWindowRateLimiter", () => {
  it("allows up to the maximum, then reports a retry time, then resets", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({ windowMs: 10_000, max: 2 }, () => now);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    const blocked = limiter.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(10);
    expect(limiter.check("b").allowed).toBe(true);
    now += 10_001;
    expect(limiter.check("a").allowed).toBe(true);
  });
});

describe("rate limiting over HTTP", () => {
  it("answers 429 with Retry-After once POSTs exceed the limit, and never limits GET", async () => {
    const app = appWith({ rateLimit: { windowMs: 60_000, max: 2 } });
    const post = () => app.inject({ method: "POST", url: "/api/runs", payload: { brief } });
    expect((await post()).statusCode).toBe(200);
    expect((await post()).statusCode).toBe(200);
    const limited = await post();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.json().requestId).toBeTruthy();
    for (let i = 0; i < 5; i += 1) {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    }
  });

  it("can be switched off", async () => {
    const app = appWith({ rateLimit: false });
    for (let i = 0; i < 5; i += 1) {
      expect((await app.inject({ method: "POST", url: "/api/runs", payload: { brief } })).statusCode).toBe(200);
    }
  });
});

describe("GET /api/metrics", () => {
  it("reports counts by route template and run status, and nothing from the brief", async () => {
    const app = appWith();
    await app.inject({ method: "POST", url: "/api/runs", payload: { brief } });
    await app.inject({ method: "GET", url: "/api/runs/does-not-exist" });
    const response = await app.inject({ method: "GET", url: "/api/metrics" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.runs.totalRuns).toBe(1);
    expect(body.runs.byBusinessStatus.READY).toBe(1);
    expect(body.http.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "POST", route: "/api/runs", status: 200, count: 1 }),
        expect.objectContaining({ method: "GET", route: "/api/runs/:runId", status: 404, count: 1 }),
      ]),
    );
    expect(response.body).not.toContain("Synthetic Spring Launch");
  });
});

describe("run deletion switch", () => {
  it("answers 403 and tells the UI when deletion is disabled", async () => {
    const store = createRunStore(":memory:");
    const app = appWith({ store, deletionEnabled: false });
    const created = (await app.inject({ method: "POST", url: "/api/runs", payload: { brief } })).json();
    const response = await app.inject({ method: "DELETE", url: `/api/runs/${created.runId}` });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DELETION_DISABLED");
    expect(store.getRun(created.runId)).toBeDefined();
    expect((await app.inject({ method: "GET", url: "/api/config" })).json().deletionEnabled).toBe(false);
  });
});

describe("DemoAuth", () => {
  it("verifies credentials and signed, expiring tokens", () => {
    let now = 1_000;
    const auth = new DemoAuth({ username: "reviewer", password: "correct horse", sessionSecret: "x".repeat(32), sessionTtlMs: 5_000 }, () => now);
    expect(auth.verifyCredentials("reviewer", "correct horse")).toBe(true);
    expect(auth.verifyCredentials("reviewer", "wrong")).toBe(false);
    expect(auth.verifyCredentials("someone", "correct horse")).toBe(false);
    const token = auth.issueToken();
    expect(auth.verifyToken(token)).toBe(true);
    expect(auth.verifyToken(`${token}0`)).toBe(false);
    expect(auth.verifyToken("9999999999999.deadbeef")).toBe(false);
    expect(auth.verifyToken(undefined)).toBe(false);
    now += 5_001;
    expect(auth.verifyToken(token)).toBe(false);
  });

  it("parses one named cookie", () => {
    expect(readCookie("a=1; bn_session=abc.def; b=2", "bn_session")).toBe("abc.def");
    expect(readCookie(undefined, "bn_session")).toBeUndefined();
  });
});

describe("login gate", () => {
  const auth = { username: "reviewer", password: "demo-pass-1234", sessionSecret: "s".repeat(32) };

  async function login(app: ReturnType<typeof appWith>, password = auth.password) {
    return app.inject({ method: "POST", url: "/api/login", payload: { username: auth.username, password } });
  }

  it("keeps the home page, login page and health public", async () => {
    const app = appWith({ auth });
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/login" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/favicon.svg" })).statusCode).toBe(200);
  });

  it("redirects /app to /login and rejects the API without a session", async () => {
    const app = appWith({ auth });
    const page = await app.inject({ method: "GET", url: "/app" });
    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toBe("/login");
    for (const [method, url] of [["GET", "/api/runs"], ["GET", "/api/config"], ["GET", "/api/metrics"], ["POST", "/api/runs"], ["DELETE", "/api/runs/x"]] as const) {
      const response = await app.inject({ method, url, ...(method === "POST" ? { payload: { brief } } : {}) });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json().error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("rejects wrong credentials without setting a cookie", async () => {
    const response = await login(appWith({ auth }), "wrong-password");
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("opens the app and API with the session cookie, and signs out", async () => {
    const app = appWith({ auth });
    const ok = await login(app);
    expect(ok.statusCode).toBe(200);
    const setCookie = String(ok.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    const cookie = setCookie.split(";")[0] ?? "";

    expect((await app.inject({ method: "GET", url: "/app", headers: { cookie } })).statusCode).toBe(200);
    const config = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(config.statusCode).toBe(200);
    expect(config.json().authRequired).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/runs", payload: { brief }, headers: { cookie } })).statusCode).toBe(200);

    const out = await app.inject({ method: "POST", url: "/api/logout", headers: { cookie } });
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/);
  });

  it("rejects a tampered cookie", async () => {
    const app = appWith({ auth });
    const cookie = String((await login(app)).headers["set-cookie"]).split(";")[0] ?? "";
    const response = await app.inject({ method: "GET", url: "/api/runs", headers: { cookie: `${cookie}ab` } });
    expect(response.statusCode).toBe(401);
  });

  it("marks the cookie Secure over HTTPS behind a trusted proxy", async () => {
    const app = appWith({ auth, trustProxy: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: auth.username, password: auth.password },
      headers: { "x-forwarded-proto": "https" },
    });
    expect(String(response.headers["set-cookie"])).toMatch(/; Secure/);
  });

  it("throttles password guessing separately and strictly", async () => {
    const app = appWith({ auth, rateLimit: false });
    let last = 0;
    for (let i = 0; i < 11; i += 1) last = (await login(app, `wrong-${i}`)).statusCode;
    expect(last).toBe(429);
  });

  it("is open when no login is configured (local development)", async () => {
    const app = appWith();
    expect((await app.inject({ method: "GET", url: "/app" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/runs" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/login", payload: {} })).statusCode).toBe(404);
  });
});
