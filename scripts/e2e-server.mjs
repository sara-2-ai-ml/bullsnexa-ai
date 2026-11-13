import { createExtractorFromEnv, createProviderFromEnv } from "../dist/agent/index.js";
import { buildApp } from "../dist/app.js";
import { createRunStore } from "../dist/persistence/run-store.js";

const env = { AGENT_PROVIDER: "simulated" };
const app = buildApp({
  auth: { username: "reviewer", password: "demo-pass-1234", sessionSecret: "e2e-only-session-secret" },
  createProvider: () => createProviderFromEnv(env),
  createExtractor: () => createExtractorFromEnv(env),
  store: createRunStore(":memory:"),
  today: () => "2026-11-13",
  rateLimit: false,
});

await app.listen({ host: "127.0.0.1", port: 4173 });
