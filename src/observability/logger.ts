import type { FastifyRequest, FastifyServerOptions } from "fastify";

const SENSITIVE_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "request.headers.authorization",
  "request.headers.cookie",
  "request.headers['x-api-key']",
  "headers.authorization",
  "headers.cookie",
  "headers['x-api-key']",
  "authorization",
  "apiKey",
  "api_key",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "password",
  "credentials",
  "secret",
  "*.authorization",
  "*.apiKey",
  "*.api_key",
  "*.token",
  "*.password",
  "*.credentials",
  "*.secret",
] as const;

export const loggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [...SENSITIVE_PATHS],
    censor: "[REDACTED]",
  },
  serializers: {
    req(request: FastifyRequest) {
      return {
        method: request.method,
        url: request.url,
        requestId: request.id,
      };
    },
  },
} satisfies NonNullable<FastifyServerOptions["logger"]>;
