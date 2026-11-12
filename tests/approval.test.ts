import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createProviderFromEnv, createExtractorFromEnv } from "../src/agent/index.js";
import {
  computePlanHash,
  deriveHandoff,
  type ApprovalRecord,
} from "../src/approval/handoff.js";
import { createRunStore, type RunStore, type StoredRun } from "../src/persistence/run-store.js";
import type { CampaignReadinessDecision } from "../src/domain/schemas.js";

const brief = {
  campaignName: "Synthetic Spring Launch",
  objective: "sales",
  targetAudience: "Synthetic retail audience",
  targetCountry: "US",
  channels: ["search", "social"],
  budgetAmount: 25_000,
  currency: "USD",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  targetKpi: { metric: "purchases", targetValue: 500 },
  category: "retail",
};
const runId = "11111111-1111-4111-8111-111111111111";

function decision(
  status: CampaignReadinessDecision["status"],
  requiresHumanReview = false,
): CampaignReadinessDecision {
  return {
    status,
    score: 80,
    scoreBreakdown: {
      completeness: { score: 1, maximum: 1 },
      budget: { score: 1, maximum: 1 },
      policyCompliance: { score: 1, maximum: 1 },
      measurableObjective: { score: 1, maximum: 1 },
      total: 80,
    },
    validationIssues: [],
    risks: [],
    clarificationQuestions: [],
    requiresHumanReview,
    policyRefs: [],
    rulesVersion: "1.0.0",
  };
}

const approvalFor = (
  value: CampaignReadinessDecision,
  hashBrief: unknown = brief,
  approvalRunId = runId,
): ApprovalRecord => ({
  runId: approvalRunId,
  decision: "APPROVED",
  reviewer: "Sara",
  comment: undefined,
  planHash: computePlanHash(approvalRunId, hashBrief, value),
  createdAt: "2026-01-15T10:00:00.000Z",
});

describe("handoff rule", () => {
  it("is not applicable without a completed evaluation", () => {
    expect(deriveHandoff({ runId, executionStatus: "FAILED", brief, decision: undefined }, undefined).status).toBe("NOT_APPLICABLE");
    expect(deriveHandoff({ runId, executionStatus: "WAITING_FOR_CLARIFICATION", brief, decision: undefined }, undefined).status).toBe("NOT_APPLICABLE");
  });

  it("never lets a BLOCKED campaign be approved", () => {
    const blocked = decision("BLOCKED");
    const handoff = deriveHandoff({ runId, executionStatus: "COMPLETED", brief, decision: blocked }, approvalFor(blocked));
    expect(handoff.status).toBe("NOT_ELIGIBLE");
  });

  it("clears READY runs and requires a person for NEEDS_REVIEW or flagged runs", () => {
    expect(deriveHandoff({ runId, executionStatus: "COMPLETED", brief, decision: decision("READY") }, undefined).status).toBe("CLEARED");
    expect(deriveHandoff({ runId, executionStatus: "COMPLETED", brief, decision: decision("NEEDS_REVIEW") }, undefined).status).toBe("PENDING_APPROVAL");
    expect(deriveHandoff({ runId, executionStatus: "COMPLETED", brief, decision: decision("READY", true) }, undefined).status).toBe("PENDING_APPROVAL");
  });

  it("applies a recorded decision only while the plan hash still matches", () => {
    const review = decision("NEEDS_REVIEW");
    const approved = approvalFor(review);
    expect(deriveHandoff({ runId, executionStatus: "COMPLETED", brief, decision: review }, approved).status).toBe("APPROVED");
    expect(deriveHandoff({ runId, executionStatus: "COMPLETED", brief, decision: review }, { ...approved, decision: "REJECTED" }).status).toBe("REJECTED");

    const changedBrief = { ...brief, budgetAmount: 99_999 };
    expect(deriveHandoff({ runId, executionStatus: "COMPLETED", brief: changedBrief, decision: review }, approved).status).toBe("APPROVAL_INVALIDATED");
    const changedDecision = { ...review, score: 10 };
    expect(deriveHandoff({ runId, executionStatus: "COMPLETED", brief, decision: changedDecision }, approved).status).toBe("APPROVAL_INVALIDATED");
  });

  it("hashes deterministically regardless of key order", () => {
    const review = decision("NEEDS_REVIEW");
    const reordered = Object.fromEntries(Object.entries(brief).reverse());
    expect(computePlanHash(runId, reordered, review)).toBe(computePlanHash(runId, brief, review));
    expect(computePlanHash(runId, { ...brief, budgetAmount: 1 }, review)).not.toBe(computePlanHash(runId, brief, review));
    expect(computePlanHash("22222222-2222-4222-8222-222222222222", brief, review)).not.toBe(
      computePlanHash(runId, brief, review),
    );
  });

  it("invalidates approvals produced with the legacy unbound hash format", () => {
    const review = decision("NEEDS_REVIEW");
    const legacy: ApprovalRecord = {
      ...approvalFor(review),
      planHash: "fec8bfdb20689e4168372d4003fd51749281e7e84d51cf90a271809ccd7ae26a",
    };
    expect(
      deriveHandoff({ runId, executionStatus: "COMPLETED", brief, decision: review }, legacy).status,
    ).toBe("APPROVAL_INVALIDATED");
  });
});

const sampleRun = (id: string, createdAt: string): StoredRun => ({
  runId: id,
  traceId: "8c0c8a2e-5a0e-4a53-9a31-8f1c2f0a7b11",
  createdAt,
  providerMode: "mock",
  executionStatus: "COMPLETED",
  businessStatus: "NEEDS_REVIEW",
  score: 80,
  summary: "summary",
  brief,
  decision: decision("NEEDS_REVIEW"),
  clarificationQuestions: [],
  error: undefined,
  usage: { requests: 1, inputTokens: 5, outputTokens: 2 },
  totalDurationMs: 12,
  events: [
    { runId: id, traceId: "8c0c8a2e-5a0e-4a53-9a31-8f1c2f0a7b11", step: 0, eventType: "AGENT_STARTED", outcome: "started" },
    { runId: id, traceId: "8c0c8a2e-5a0e-4a53-9a31-8f1c2f0a7b11", step: 1, eventType: "TOOL_SUCCEEDED", toolName: "x", outcome: "ok", durationMs: 3, attempt: 1 },
  ] as never,
});

describe("SQLite run store", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("round-trips a run with ordered events, newest first in lists", () => {
    const store = createRunStore();
    store.saveRun(sampleRun("11111111-1111-4111-8111-111111111111", "2026-01-15T10:00:00.000Z"));
    store.saveRun(sampleRun("22222222-2222-4222-8222-222222222222", "2026-01-15T11:00:00.000Z"));

    const loaded = store.getRun("11111111-1111-4111-8111-111111111111")!;
    expect(loaded.brief).toEqual(brief);
    expect(loaded.events.map((event) => event.eventType)).toEqual(["AGENT_STARTED", "TOOL_SUCCEEDED"]);
    expect(loaded.usage).toEqual({ requests: 1, inputTokens: 5, outputTokens: 2 });
    expect(store.listRuns(1)[0]!.runId).toBe("22222222-2222-4222-8222-222222222222");
    expect(store.getRun("33333333-3333-4333-8333-333333333333")).toBeUndefined();
    store.close();
  });

  it("allows one decision per run and rejects approvals for unknown runs", () => {
    const store = createRunStore();
    const id = "11111111-1111-4111-8111-111111111111";
    store.saveRun(sampleRun(id, "2026-01-15T10:00:00.000Z"));
    const record = { ...approvalFor(decision("NEEDS_REVIEW")), runId: id };

    expect(store.saveApproval(record)).toBe(true);
    expect(store.saveApproval({ ...record, decision: "REJECTED" })).toBe(false);
    expect(store.getApproval(id)?.decision).toBe("APPROVED");
    expect(() => store.saveApproval({ ...record, runId: "44444444-4444-4444-8444-444444444444" })).toThrow();
    store.close();
  });

  it("keeps data across reopening a file database", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bullsnexa-"));
    dirs.push(dir);
    const file = path.join(dir, "nested", "runs.sqlite");
    const first = createRunStore(file);
    first.saveRun(sampleRun("11111111-1111-4111-8111-111111111111", "2026-01-15T10:00:00.000Z"));
    first.close();

    const second = createRunStore(file);
    expect(second.getRun("11111111-1111-4111-8111-111111111111")?.summary).toBe("summary");
    second.close();
  });

  it("treats SQL-looking input as data", () => {
    const store = createRunStore();
    const evil = "x'); DROP TABLE runs; --";
    store.saveRun({ ...sampleRun("11111111-1111-4111-8111-111111111111", "2026-01-15T10:00:00.000Z"), summary: evil });
    expect(store.getRun("11111111-1111-4111-8111-111111111111")?.summary).toBe(evil);
    expect(store.listRuns(5)).toHaveLength(1);
    store.close();
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["schema-invalid JSON", JSON.stringify({ status: "READY" })],
  ])("rejects corrupted stored records with %s", (_label, corruptedDecision) => {
    const dir = mkdtempSync(path.join(tmpdir(), "bullsnexa-corrupt-"));
    dirs.push(dir);
    const file = path.join(dir, "runs.sqlite");
    const store = createRunStore(file);
    store.saveRun(sampleRun(runId, "2026-01-15T10:00:00.000Z"));
    store.close();

    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE runs SET decision_json = ? WHERE run_id = ?").run(
      corruptedDecision,
      runId,
    );
    raw.close();

    const reopened = createRunStore(file);
    expect(() => reopened.getRun(runId)).toThrowError(
      "A persisted record failed integrity validation.",
    );
    reopened.close();
  });
});

describe("run, history and approval API", () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  const apiDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    apiDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  function setup(store: RunStore = createRunStore()) {
    const env = { AGENT_PROVIDER: "mock" };
    const app = buildApp({
      store,
      createProvider: () => createProviderFromEnv(env),
      createExtractor: () => createExtractorFromEnv(env),
      today: () => "2026-01-15",
    });
    apps.push(app);
    return { app, store };
  }

  const run = async (app: ReturnType<typeof buildApp>, body: unknown) =>
    (await app.inject({ method: "POST", url: "/api/runs", payload: { brief: body } })).json();

  const review = { ...brief, budgetAmount: 150_000 };

  it("persists each run and exposes history and detail with trace and timing", async () => {
    const { app } = setup();
    const created = await run(app, brief);

    expect(created.persisted).toBe(true);
    expect(created.handoff.status).toBe("CLEARED");
    expect(created.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.totalDurationMs).toBeGreaterThanOrEqual(0);

    const list = (await app.inject({ method: "GET", url: "/api/runs" })).json();
    expect(list.runs[0]).toMatchObject({ runId: created.runId, businessStatus: "READY", handoffStatus: "CLEARED" });

    const detail = (await app.inject({ method: "GET", url: `/api/runs/${created.runId}` })).json();
    expect(detail.trace.length).toBe(created.trace.length);
    expect(detail.brief.campaignName).toBe("Synthetic Spring Launch");
    expect(detail.launchPlan).toEqual(created.launchPlan);
    expect(detail.traceId).toBe(created.traceId);
  });

  it("requires approval for NEEDS_REVIEW, binds it to the plan hash, and allows one decision", async () => {
    const { app } = setup();
    const created = await run(app, review);
    expect(created.businessStatus).toBe("NEEDS_REVIEW");
    expect(created.handoff.status).toBe("PENDING_APPROVAL");
    const url = `/api/runs/${created.runId}/approval`;
    const payload = { decision: "APPROVED", reviewer: "Sara", comment: "ok", planHash: created.planHash };

    const stale = await app.inject({ method: "POST", url, payload: { ...payload, planHash: "0".repeat(64) } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("PLAN_HASH_MISMATCH");

    const ok = await app.inject({ method: "POST", url, payload });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().handoff.status).toBe("APPROVED");

    const again = await app.inject({ method: "POST", url, payload: { ...payload, decision: "REJECTED" } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("ALREADY_DECIDED");

    const detail = (await app.inject({ method: "GET", url: `/api/runs/${created.runId}` })).json();
    expect(detail.handoff.status).toBe("APPROVED");
    expect(detail.approval.reviewer).toBe("Sara");
  });

  it("allows only one of two concurrent approval attempts to succeed", async () => {
    const { app } = setup();
    const created = await run(app, review);
    const request = {
      method: "POST" as const,
      url: `/api/runs/${created.runId}/approval`,
      payload: {
        decision: "APPROVED",
        reviewer: "Concurrent reviewer",
        planHash: created.planHash,
      },
    };

    const responses = await Promise.all([app.inject(request), app.inject(request)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.statusCode === 409)?.json().error.code).toBe(
      "ALREADY_DECIDED",
    );
  });

  it("binds otherwise identical approval plans to different run ids", async () => {
    const { app } = setup();
    const first = await run(app, review);
    const second = await run(app, review);

    expect(first.runId).not.toBe(second.runId);
    expect(first.planHash).not.toBe(second.planHash);
  });

  it("refuses approval when none is needed or the campaign is blocked", async () => {
    const { app } = setup();
    for (const body of [brief, { ...brief, budgetAmount: -5 }]) {
      const created = await run(app, body);
      const response = await app.inject({
        method: "POST",
        url: `/api/runs/${created.runId}/approval`,
        payload: { decision: "APPROVED", reviewer: "Sara", planHash: created.planHash },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("APPROVAL_NOT_ALLOWED");
    }
  });

  it("invalidates an approval whose recorded plan no longer matches the stored plan", async () => {
    const { app, store } = setup();
    const created = await run(app, review);
    store.saveApproval({
      runId: created.runId,
      decision: "APPROVED",
      reviewer: "Sara",
      comment: undefined,
      planHash: "f".repeat(64),
      createdAt: "2026-01-15T10:00:00.000Z",
    });

    const detail = (await app.inject({ method: "GET", url: `/api/runs/${created.runId}` })).json();
    expect(detail.handoff.status).toBe("APPROVAL_INVALIDATED");
    const list = (await app.inject({ method: "GET", url: "/api/runs" })).json();
    expect(list.runs[0].handoffStatus).toBe("APPROVAL_INVALIDATED");
  });

  it("invalidates approval after persisted brief data actually changes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bullsnexa-mutation-"));
    apiDirs.push(dir);
    const file = path.join(dir, "runs.sqlite");
    const store = createRunStore(file);
    const { app } = setup(store);
    const created = await run(app, review);
    const approved = await app.inject({
      method: "POST",
      url: `/api/runs/${created.runId}/approval`,
      payload: {
        decision: "APPROVED",
        reviewer: "Sara",
        planHash: created.planHash,
      },
    });
    expect(approved.statusCode).toBe(200);

    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE runs SET brief_json = ? WHERE run_id = ?").run(
      JSON.stringify({ ...review, budgetAmount: 175_000 }),
      created.runId,
    );
    raw.close();

    const detail = (
      await app.inject({ method: "GET", url: `/api/runs/${created.runId}` })
    ).json();
    expect(detail.handoff.status).toBe("APPROVAL_INVALIDATED");
  });

  it("validates approval input and ids", async () => {
    const { app } = setup();
    const created = await run(app, review);
    const url = `/api/runs/${created.runId}/approval`;

    for (const payload of [
      {},
      { decision: "MAYBE", reviewer: "Sara", planHash: created.planHash },
      { decision: "APPROVED", reviewer: "S", planHash: created.planHash },
      { decision: "APPROVED", reviewer: "Sara", planHash: "short" },
      { decision: "APPROVED", reviewer: "Sara", planHash: created.planHash, extra: 1 },
    ]) {
      const response = await app.inject({ method: "POST", url, payload });
      expect(response.statusCode).toBe(400);
    }
    const unknown = await app.inject({
      method: "POST",
      url: "/api/runs/44444444-4444-4444-8444-444444444444/approval",
      payload: { decision: "APPROVED", reviewer: "Sara", planHash: "a".repeat(64) },
    });
    expect(unknown.statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/runs/not-a-uuid" })).statusCode).toBe(404);
  });

  it("still returns the decision, flagged as not persisted, if storage fails", async () => {
    const base = createRunStore();
    const broken: RunStore = {
      ...base,
      saveRun() {
        throw new Error("disk full");
      },
    };
    const { app } = setup(broken);
    const created = await run(app, brief);

    expect(created.businessStatus).toBe("READY");
    expect(created.persisted).toBe(false);
    expect(JSON.stringify(created)).not.toContain("disk full");
  });

  it("cannot approve an unpersisted NEEDS_REVIEW run", async () => {
    const base = createRunStore();
    const broken: RunStore = {
      ...base,
      saveRun() {
        throw new Error("disk full");
      },
    };
    const { app } = setup(broken);
    const created = await run(app, review);

    expect(created.persisted).toBe(false);
    expect(created.handoff.status).toBe("PENDING_APPROVAL");
    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${created.runId}/approval`,
      payload: {
        decision: "APPROVED",
        reviewer: "Sara",
        planHash: created.planHash,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("RUN_NOT_FOUND");
  });
});
