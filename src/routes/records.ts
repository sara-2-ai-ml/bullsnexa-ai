import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  ApprovalRequestSchema,
  computePlanHash,
  deriveHandoff,
} from "../approval/handoff.js";
import { createLaunchPlan } from "../domain/launch-plan.js";
import type { RunStore, StoredRun } from "../persistence/run-store.js";

export interface RecordRoutesOptions {
  readonly store: RunStore;
}

const RunIdSchema = z.string().uuid();
const LIST_LIMIT = 20;

function describe(store: RunStore, run: StoredRun) {
  const approval = store.getApproval(run.runId);
  const handoff = deriveHandoff(run, approval);
  return {
    approval,
    handoff,
    planHash: run.decision
      ? computePlanHash(run.runId, run.brief, run.decision)
      : undefined,
  };
}

export const recordRoutes: FastifyPluginAsync<RecordRoutesOptions> = async (
  app,
  { store },
) => {
  app.get("/api/runs", async () => ({
    runs: store.listRuns(LIST_LIMIT).map((run) => ({
      runId: run.runId,
      createdAt: run.createdAt,
      campaignName:
        typeof run.brief === "object" &&
        run.brief !== null &&
        typeof (run.brief as { campaignName?: unknown }).campaignName === "string"
          ? String((run.brief as { campaignName: string }).campaignName).slice(0, 80)
          : undefined,
      providerMode: run.providerMode,
      executionStatus: run.executionStatus,
      businessStatus: run.businessStatus,
      score: run.score,
      handoffStatus: describe(store, run).handoff.status,
    })),
  }));

  app.get("/api/runs/:runId", async (request, reply) => {
    const id = RunIdSchema.safeParse((request.params as { runId: string }).runId);
    const run = id.success ? store.getRun(id.data) : undefined;
    if (!run) {
      return reply.code(404).send({
        error: { code: "RUN_NOT_FOUND", message: "Run not found" },
        requestId: request.id,
      });
    }
    const { approval, handoff, planHash } = describe(store, run);
    const launchPlan = run.decision
      ? createLaunchPlan(run.brief, run.decision)
      : undefined;
    return {
      runId: run.runId,
      traceId: run.traceId,
      createdAt: run.createdAt,
      executionStatus: run.executionStatus,
      businessStatus: run.businessStatus,
      decision: run.decision,
      clarificationQuestions: run.clarificationQuestions,
      error: run.error,
      summary: run.summary,
      provider: { mode: run.providerMode, usage: run.usage },
      trace: run.events,
      totalDurationMs: run.totalDurationMs,
      brief: run.brief,
      planHash,
      launchPlan: launchPlan?.ok ? launchPlan.plan : undefined,
      launchPlanUnavailable: launchPlan && !launchPlan.ok ? launchPlan.reason : undefined,
      handoff,
      approval,
    };
  });

  app.delete("/api/runs/:runId", async (request, reply) => {
    const id = RunIdSchema.safeParse((request.params as { runId: string }).runId);
    if (!id.success || !store.deleteRun(id.data)) {
      return reply.code(404).send({
        error: { code: "RUN_NOT_FOUND", message: "Run not found" },
        requestId: request.id,
      });
    }
    return reply.code(204).send();
  });

  app.post(
    "/api/runs/:runId/approval",
    { bodyLimit: 4 * 1024 },
    async (request, reply) => {
      const fail = (status: number, code: string, message: string) =>
        reply.code(status).send({ error: { code, message }, requestId: request.id });

      const id = RunIdSchema.safeParse((request.params as { runId: string }).runId);
      const body = ApprovalRequestSchema.safeParse(request.body);
      if (!body.success) {
        return fail(
          400,
          "INVALID_REQUEST",
          "Body must be { decision, reviewer (2-80 chars), comment?, planHash }",
        );
      }
      const run = id.success ? store.getRun(id.data) : undefined;
      if (!run) return fail(404, "RUN_NOT_FOUND", "Run not found");

      const existing = store.getApproval(run.runId);
      if (existing) {
        return fail(409, "ALREADY_DECIDED", "This run already has a recorded decision");
      }
      const handoff = deriveHandoff(run, undefined);
      if (handoff.status !== "PENDING_APPROVAL") {
        return fail(409, "APPROVAL_NOT_ALLOWED", handoff.reason);
      }
      const currentHash = computePlanHash(run.runId, run.brief, run.decision!);
      if (body.data.planHash !== currentHash) {
        return fail(
          409,
          "PLAN_HASH_MISMATCH",
          "The plan you reviewed is not the stored plan; reload and review again",
        );
      }

      const record = {
        runId: run.runId,
        decision: body.data.decision,
        reviewer: body.data.reviewer,
        comment: body.data.comment || undefined,
        planHash: currentHash,
        createdAt: new Date().toISOString(),
      };
      if (!store.saveApproval(record)) {
        return fail(409, "ALREADY_DECIDED", "This run already has a recorded decision");
      }
      request.log.info(
        { runId: run.runId, decision: record.decision },
        "Approval decision recorded",
      );
      return { approval: record, handoff: deriveHandoff(run, record) };
    },
  );
};
