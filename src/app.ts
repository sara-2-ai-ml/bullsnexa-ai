import { randomUUID } from "node:crypto";

import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";

import {
  createExtractorFromEnv,
  createProviderFromEnv,
  type AgentProvider,
  type BriefExtractor,
} from "./agent/index.js";
import { DemoAuth, SESSION_COOKIE, readCookie, type AuthConfig } from "./http/auth.js";
import { HttpMetrics } from "./http/metrics.js";
import { FixedWindowRateLimiter, type RateLimitConfig } from "./http/rate-limit.js";
import { createRunStore, type RunStore } from "./persistence/run-store.js";
import { loggerOptions } from "./observability/logger.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { metricsRoutes } from "./routes/metrics.js";
import { recordRoutes } from "./routes/records.js";
import { runRoutes } from "./routes/runs.js";

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function requestIdFromHeader(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

export interface BuildAppOptions {
  readonly createProvider?: () => AgentProvider;
  readonly createExtractor?: () => BriefExtractor;
  /** Defaults to a private in-memory store so tests never touch disk. */
  readonly store?: RunStore;
  readonly today?: () => string;
  /**
   * Per-client limit on POST and DELETE requests under /api. Defaults to 60 per
   * minute; pass `false` to disable. In-memory and per process.
   */
  readonly rateLimit?: RateLimitConfig | false;
  /** When false, DELETE /api/runs/:id answers 403. Defaults to true. */
  readonly deletionEnabled?: boolean;
  /**
   * Optional shared demo login. When set, /app and every /api route except
   * /api/login require a valid session cookie. When omitted the app is open
   * (local development and tests).
   */
  readonly auth?: AuthConfig;
  /** Trust X-Forwarded-For (only behind a proxy you control). Defaults to false. */
  readonly trustProxy?: boolean;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 60 };

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: loggerOptions,
    requestIdHeader: false,
    trustProxy: options.trustProxy ?? false,
    genReqId: (request) => requestIdFromHeader(request.headers["x-request-id"]),
  });

  const store = options.store ?? createRunStore(":memory:");
  app.addHook("onClose", async () => {
    store.close();
  });

  const metrics = new HttpMetrics();
  const limiter =
    options.rateLimit === false
      ? undefined
      : new FixedWindowRateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT);
  const deletionEnabled = options.deletionEnabled ?? true;
  const auth = options.auth ? new DemoAuth(options.auth) : undefined;
  const loginLimiter = auth
    ? new FixedWindowRateLimiter({ windowMs: 60_000, max: 10 })
    : undefined;

  const tooMany = (request: FastifyRequest, reply: FastifyReply, retryAfterSeconds: number) => {
    metrics.recordRateLimited();
    const response: ErrorResponse = {
      error: {
        code: "RATE_LIMITED",
        message: `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
      },
      requestId: request.id,
    };
    return reply.code(429).header("retry-after", String(retryAfterSeconds)).send(response);
  };

  // 1) Rate limits come first, so unauthenticated floods and password guessing are throttled too.
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST" && request.method !== "DELETE") return;
    const pathname = request.url.split("?")[0] ?? "";
    if (!pathname.startsWith("/api/")) return;
    const limit = pathname === "/api/login" && loginLimiter ? loginLimiter : limiter;
    if (!limit) return;
    const decision = limit.check(request.ip);
    if (!decision.allowed) return tooMany(request, reply, decision.retryAfterSeconds);
  });

  // 2) Authentication. Public: home page, login page, health, static assets, login itself.
  app.addHook("onRequest", async (request, reply) => {
    if (!auth) return;
    const pathname = request.url.split("?")[0] ?? "";
    const isApi = pathname.startsWith("/api/");
    if (!isApi && pathname !== "/app") return;
    if (pathname === "/api/login") return;
    if (auth.verifyToken(readCookie(request.headers.cookie, SESSION_COOKIE))) return;
    if (!isApi) return reply.redirect("/login");
    const response: ErrorResponse = {
      error: { code: "UNAUTHENTICATED", message: "Sign in to use this API" },
      requestId: request.id,
    };
    return reply.code(401).send(response);
  });
  app.addHook("onResponse", async (request, reply) => {
    metrics.record(request.method, request.routeOptions?.url ?? "unmatched", reply.statusCode);
  });

  app.register(healthRoutes);
  if (auth) app.register(authRoutes, { auth });
  app.register(metricsRoutes, { store, metrics });
  app.register(recordRoutes, { store, deletionEnabled });
  app.register(runRoutes, {
    store,
    deletionEnabled,
    authRequired: auth !== undefined,
    createProvider: options.createProvider ?? (() => createProviderFromEnv()),
    createExtractor: options.createExtractor ?? (() => createExtractorFromEnv()),
    ...(options.today ? { today: options.today } : {}),
  });

  app.setNotFoundHandler((request, reply) => {
    const response: ErrorResponse = {
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
      requestId: request.id,
    };

    return reply.code(404).send(response);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      const clientError: ErrorResponse = {
        error: {
          code: status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
          message:
            status === 413
              ? "Request body is too large"
              : "The request could not be processed",
        },
        requestId: request.id,
      };
      return reply.code(status).send(clientError);
    }

    request.log.error(
      { err: error, requestId: request.id },
      "Request failed",
    );

    const response: ErrorResponse = {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
      },
      requestId: request.id,
    };

    return reply.code(500).send(response);
  });

  return app;
}
