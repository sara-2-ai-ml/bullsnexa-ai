import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("application foundation", () => {
  it("builds and tests without opening a network port", async () => {
    const app = buildApp();
    apps.push(app);

    expect(app.server.listening).toBe(false);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(app.server.listening).toBe(false);
  });

  it("returns the expected health response", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "bulls-nexa" });
  });

  it("returns a consistent 404 response with a request ID", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/unknown" });
    const payload = response.json();

    expect(response.statusCode).toBe(404);
    expect(payload).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
      requestId: expect.any(String),
    });
  });

  it("returns the safe error envelope without internal details", async () => {
    const app = buildApp();
    apps.push(app);
    app.get("/test-error", async () => {
      throw new Error("sensitive internal detail");
    });

    const response = await app.inject({ method: "GET", url: "/test-error" });
    const payload = response.json();

    expect(response.statusCode).toBe(500);
    expect(payload).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
      },
      requestId: expect.any(String),
    });
    expect(response.body).not.toContain("sensitive internal detail");
    expect(response.body).not.toContain("stack");
  });
});
