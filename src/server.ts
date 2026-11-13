import { z } from "zod";

import { buildApp } from "./app.js";
import { createRunStore } from "./persistence/run-store.js";

/** Public demo login, documented in the README. Not a secret. */
const DEMO_USERNAME = "reviewer";
const DEMO_PASSWORD = "demo-pass-1234";

const runtimeSchema = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  DATABASE_PATH: z.string().min(1).default("var/bullsnexa.sqlite"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  /** Requests per window for POST/DELETE under /api; 0 disables the limiter. */
  RATE_LIMIT_MAX: z.coerce.number().int().min(0).max(100_000).default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  /** "disabled" makes DELETE /api/runs/:id answer 403 (for a public demo). */
  RUN_DELETION: z.enum(["enabled", "disabled"]).default("enabled"),
  /**
   * The demo always asks for a sign-in. These defaults are public demo
   * credentials (they are printed in the README); override both on a deployment.
   */
  AUTH_USERNAME: z.string().min(1).max(100).default(DEMO_USERNAME),
  AUTH_PASSWORD: z.string().min(8).max(200).default(DEMO_PASSWORD),
  /** "disabled" turns the sign-in off (for example for local scripting). */
  AUTH: z.enum(["enabled", "disabled"]).default("enabled"),
  /** Optional; keeps sessions valid across restarts. Random per process when unset. */
  SESSION_SECRET: z.string().min(16).max(200).optional(),
  /** "true" only behind a reverse proxy you control. */
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
});

async function start(): Promise<void> {
  const config = runtimeSchema.parse(process.env);
  const auth =
    config.AUTH === "enabled"
      ? {
          username: config.AUTH_USERNAME,
          password: config.AUTH_PASSWORD,
          ...(config.SESSION_SECRET ? { sessionSecret: config.SESSION_SECRET } : {}),
        }
      : undefined;
  const app = buildApp({
    store: createRunStore(config.DATABASE_PATH),
    rateLimit:
      config.RATE_LIMIT_MAX === 0
        ? false
        : { max: config.RATE_LIMIT_MAX, windowMs: config.RATE_LIMIT_WINDOW_MS },
    deletionEnabled: config.RUN_DELETION === "enabled",
    trustProxy: config.TRUST_PROXY === "true",
    ...(auth ? { auth } : {}),
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, "Shutdown requested");
    try {
      await app.close();
      process.exitCode = 0;
    } catch (error) {
      app.log.error({ err: error }, "Graceful shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  if (auth && auth.username === DEMO_USERNAME && auth.password === DEMO_PASSWORD) {
    app.log.warn("Sign-in uses the public demo credentials from the README; set AUTH_USERNAME and AUTH_PASSWORD on a deployment.");
  }

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.fatal({ err: error }, "Application startup failed");
    process.exitCode = 1;
    await app.close();
  }
}

start().catch((error: unknown) => {
  console.error("Startup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
