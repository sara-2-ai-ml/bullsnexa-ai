import { randomUUID } from "node:crypto";

import Fastify, { type FastifyError } from "fastify";

import {
  createExtractorFromEnv,
  createProviderFromEnv,
  type AgentProvider,
  type BriefExtractor,
} from "./agent/index.js";
import { createRunStore, type RunStore } from "./persistence/run-store.js";
import { loggerOptions } from "./observability/logger.js";
import { healthRoutes } from "./routes/health.js";
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
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: loggerOptions,
    requestIdHeader: false,
    genReqId: (request) => requestIdFromHeader(request.headers["x-request-id"]),
  });

  const store = options.store ?? createRunStore(":memory:");
  app.addHook("onClose", async () => {
    store.close();
  });

  app.register(healthRoutes);
  app.register(recordRoutes, { store });
  app.register(runRoutes, {
    store,
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
