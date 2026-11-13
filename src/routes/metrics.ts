import type { FastifyPluginAsync } from "fastify";

import type { HttpMetrics } from "../http/metrics.js";
import type { RunStore } from "../persistence/run-store.js";

export interface MetricsRoutesOptions {
  readonly store: RunStore;
  readonly metrics: HttpMetrics;
}

/**
 * Operational counters only: request counts per route template and status,
 * and aggregate run counts. It never exposes a brief, trace or approval text.
 */
export const metricsRoutes: FastifyPluginAsync<MetricsRoutesOptions> = async (
  app,
  { store, metrics },
) => {
  app.get("/api/metrics", async () => ({
    http: metrics.snapshot(),
    runs: store.stats(),
  }));
};
