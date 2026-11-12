import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createExtractorFromEnv, createProviderFromEnv } from "../src/agent/index.js";
import { runAgentEvaluations } from "../src/eval/index.js";

describe("agent evaluations (all 15 dataset cases through the real pipeline)", () => {
  it("passes every case with every check", async () => {
    const report = await runAgentEvaluations();

    const failures = report.rows
      .filter((row) => !row.passed)
      .map((row) => `${row.id}: ${row.checks.filter((entry) => !entry.passed).map((entry) => entry.name).join("; ")} (${row.observed})`);
    expect(failures).toEqual([]);
    expect(report.total).toBe(15);
    expect(report.passed).toBe(15);
  });

  it("covers the 8 trusted-result cases and the 7 security / fault cases with real checks", async () => {
    const report = await runAgentEvaluations();

    expect(new Set(report.rows.map((row) => row.id)).size).toBe(15);
    for (const row of report.rows) {
      expect(row.checks.length, row.id).toBeGreaterThanOrEqual(3);
      expect(row.expected, row.id).not.toMatch(/NOT_EXECUTED/);
    }
    const categories = report.rows.map((row) => row.category);
    for (const needed of ["future-security", "future-tool-error", "future-provider-error", "future-authorization", "future-approval-integrity"]) {
      expect(categories).toContain(needed);
    }
  });

  it("is deterministic across runs", async () => {
    const first = await runAgentEvaluations();
    const second = await runAgentEvaluations();

    expect(second.rows.map((row) => [row.id, row.observed, row.passed])).toEqual(
      first.rows.map((row) => [row.id, row.observed, row.passed]),
    );
  });
});

describe("end-to-end: free text -> extraction -> agent -> approval -> history", () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("walks the whole product flow through the HTTP API", async () => {
    const env = { AGENT_PROVIDER: "simulated" };
    const app = buildApp({
      createProvider: () => createProviderFromEnv(env),
      createExtractor: () => createExtractorFromEnv(env),
      today: () => "2026-11-12",
    });
    apps.push(app);

    const text =
      'Called "Winter Boots". Objective: sales. Audience: outdoor shoppers. Budget $150,000 on Google and Instagram in the US, 2027-01-10 to 2027-02-10, aim for 900 purchases. Category: retail.';
    const extracted = (await app.inject({ method: "POST", url: "/api/extract", payload: { text } })).json();
    expect(extracted.extractedFields).toEqual(expect.arrayContaining(["budgetAmount", "currency", "startDate", "endDate"]));

    const run = (await app.inject({ method: "POST", url: "/api/runs", payload: { brief: extracted.brief } })).json();
    expect(run.executionStatus).toBe("COMPLETED");
    expect(run.businessStatus).toBe("NEEDS_REVIEW");
    expect(run.handoff.status).toBe("PENDING_APPROVAL");
    expect(run.tools.map((tool: { toolName: string }) => tool.toolName)).toEqual([
      "checkCampaignFields",
      "searchCampaignPolicies",
      "evaluateCampaignReadiness",
    ]);

    const approved = await app.inject({
      method: "POST",
      url: `/api/runs/${run.runId}/approval`,
      payload: { decision: "APPROVED", reviewer: "E2E Reviewer", planHash: run.planHash },
    });
    expect(approved.statusCode).toBe(200);

    const detail = (await app.inject({ method: "GET", url: `/api/runs/${run.runId}` })).json();
    expect(detail.handoff.status).toBe("APPROVED");
    expect(detail.trace.some((event: { eventType: string }) => event.eventType === "AGENT_COMPLETED")).toBe(true);

    const history = (await app.inject({ method: "GET", url: "/api/runs" })).json();
    expect(history.runs[0]).toMatchObject({ runId: run.runId, handoffStatus: "APPROVED" });
  });
});
