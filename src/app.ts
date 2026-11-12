import { randomUUID } from "node:crypto";

import Fastify, { type FastifyError } from "fastify";

import { loggerOptions } from "./observability/logger.js";
import { healthRoutes } from "./routes/health.js";

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

export function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
    requestIdHeader: false,
    genReqId: (request) => requestIdFromHeader(request.headers["x-request-id"]),
  });

  app.register(healthRoutes);

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
