import { z } from "zod";

import { buildApp } from "./app.js";
import { createRunStore } from "./persistence/run-store.js";

const runtimeSchema = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  DATABASE_PATH: z.string().min(1).default("var/bullsnexa.sqlite"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

async function start(): Promise<void> {
  const config = runtimeSchema.parse(process.env);
  const app = buildApp({ store: createRunStore(config.DATABASE_PATH) });

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
