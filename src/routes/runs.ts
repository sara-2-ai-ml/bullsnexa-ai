import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { computePlanHash, deriveHandoff } from "../approval/handoff.js";
import { createLaunchPlan } from "../domain/launch-plan.js";
import type { RunStore } from "../persistence/run-store.js";

import {
  AgentConfigurationError,
  BriefExtractionError,
  MAX_EXTRACTION_INPUT_CHARS,
  currentIsoDate,
  type BriefExtractor,
  runCampaignAgent,
  type AgentProvider,
} from "../agent/index.js";

export interface RunRoutesOptions {
  /** Creates a fresh provider per run (providers keep per-run state). */
  readonly createProvider: () => AgentProvider;
  /** Persists runs, events and approvals. */
  readonly store: RunStore;
  /** Creates the free-text brief extractor. */
  readonly createExtractor: () => BriefExtractor;
  /** Application-boundary clock; injected so tests stay deterministic. */
  readonly today?: () => string;
}

const RunRequestSchema = z
  .object({ brief: z.record(z.string(), z.unknown()) })
  .strict();

const ExtractRequestSchema = z
  .object({ text: z.string().trim().min(3).max(MAX_EXTRACTION_INPUT_CHARS) })
  .strict();

const PUBLIC_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
);

export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (
  app,
  options,
) => {
  const today = options.today ?? (() => currentIsoDate());
  const pageCache = new Map<string, Promise<string>>();

  const servePage = (route: string, file: string): void => {
    app.get(route, async (request, reply) => {
      let page = pageCache.get(file);
      if (page === undefined) {
        page = readFile(path.join(PUBLIC_DIRECTORY, file), "utf8");
        pageCache.set(file, page);
      }
      try {
        const html = await page;
        return reply
          .type("text/html; charset=utf-8")
          .header("x-content-type-options", "nosniff")
          .header(
            "content-security-policy",
            "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
          )
          .send(html);
      } catch {
        pageCache.delete(file);
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "UI is not available" },
          requestId: request.id,
        });
      }
    });
  };

  // "/" is the home page; "/app" is the working tool.
  servePage("/", "index.html");
  servePage("/app", "app.html");

  // Favicon: the only image the pages load, served from the same origin.
  let faviconCache: Promise<string> | undefined;
  app.get("/favicon.svg", async (_request, reply) => {
    faviconCache ??= readFile(path.join(PUBLIC_DIRECTORY, "favicon.svg"), "utf8");
    try {
      const svg = await faviconCache;
      return reply
        .type("image/svg+xml; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "public, max-age=3600")
        .send(svg);
    } catch {
      faviconCache = undefined;
      return reply.code(404).send({
        error: { code: "NOT_FOUND", message: "Favicon is not available" },
        requestId: _request.id,
      });
    }
  });

  app.get("/api/config", async () => {
    const provider = options.createProvider();
    return { providerMode: provider.mode ?? "custom", today: today() };
  });

  app.post("/api/extract", { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const parsed = ExtractRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: `Body must be { text: string } with 3-${MAX_EXTRACTION_INPUT_CHARS} characters`,
        },
        requestId: request.id,
      });
    }

    const controller = new AbortController();
    request.raw.once("close", () => {
      if (!request.raw.complete) controller.abort();
    });

    try {
      const extractor = options.createExtractor();
      const result = await extractor.extract(parsed.data.text, {
        today: today(),
        signal: controller.signal,
      });
      return {
        brief: result.brief,
        extractedFields: result.extractedFields,
        droppedFields: result.droppedFields,
        mode: result.mode,
        usage: result.usage,
        notice:
          "Extracted by a model from free text. Review every field before running the agent.",
      };
    } catch (error) {
      if (error instanceof AgentConfigurationError) {
        return reply.code(503).send({
          error: { code: error.code, message: error.message },
          requestId: request.id,
        });
      }
      if (error instanceof BriefExtractionError) {
        const status =
          error.code === "EXTRACTION_INPUT_INVALID"
            ? 400
            : error.code === "EXTRACTION_TIMEOUT"
              ? 504
              : 502;
        return reply.code(status).send({
          error: { code: error.code, message: error.message },
          requestId: request.id,
        });
      }
      throw error;
    }
  });

  app.post("/api/runs", { bodyLimit: 32 * 1024 }, async (request, reply) => {
    const parsed = RunRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Body must be a JSON object of the form { brief: { ... } }",
        },
        requestId: request.id,
      });
    }

    let provider: AgentProvider;
    try {
      provider = options.createProvider();
    } catch (error) {
      if (error instanceof AgentConfigurationError) {
        return reply.code(503).send({
          error: { code: error.code, message: error.message },
          requestId: request.id,
        });
      }
      throw error;
    }

    const startedAt = performance.now();
    const result = await runCampaignAgent({
      brief: parsed.data.brief,
      today: today(),
      provider,
    });
    const totalDurationMs = Math.round(performance.now() - startedAt);

    const handoff = deriveHandoff(
      {
        runId: result.runId,
        executionStatus: result.executionStatus,
        brief: parsed.data.brief,
        decision: result.finalDecision,
      },
      undefined,
    );
    const planHash = result.finalDecision
      ? computePlanHash(result.runId, parsed.data.brief, result.finalDecision)
      : undefined;

    const launchPlan = result.finalDecision
      ? createLaunchPlan(parsed.data.brief, result.finalDecision)
      : undefined;

    let persisted = true;
    try {
      options.store.saveRun({
        runId: result.runId,
        traceId: result.traceId,
        createdAt: new Date().toISOString(),
        providerMode: result.provider?.mode ?? "custom",
        executionStatus: result.executionStatus,
        businessStatus: result.finalDecision?.status,
        score: result.finalDecision?.score,
        summary: result.summary,
        brief: parsed.data.brief,
        decision: result.finalDecision,
        clarificationQuestions: result.clarificationQuestions,
        error: result.error,
        usage: result.provider?.usage,
        totalDurationMs,
        events: result.executionHistory,
      });
    } catch (error) {
      persisted = false;
      request.log.error({ err: error, runId: result.runId }, "Run could not be persisted");
    }

    // Never log the brief: only identifiers, statuses and timings.
    request.log.info(
      {
        runId: result.runId,
        traceId: result.traceId,
        providerMode: result.provider?.mode,
        executionStatus: result.executionStatus,
        businessStatus: result.finalDecision?.status,
        handoff: handoff.status,
        durationMs: totalDurationMs,
        persisted,
      },
      "Agent run finished",
    );

    return {
      runId: result.runId,
      traceId: result.traceId,
      executionStatus: result.executionStatus,
      businessStatus: result.finalDecision?.status,
      decision: result.finalDecision,
      clarificationQuestions: result.clarificationQuestions,
      error: result.error,
      summary: result.summary,
      provider: result.provider,
      tools: result.toolResults.map(({ toolName, success }) => ({
        toolName,
        success,
      })),
      trace: result.executionHistory,
      totalDurationMs,
      planHash,
      launchPlan: launchPlan?.ok ? launchPlan.plan : undefined,
      launchPlanUnavailable: launchPlan && !launchPlan.ok ? launchPlan.reason : undefined,
      handoff,
      persisted,
    };
  });
};
