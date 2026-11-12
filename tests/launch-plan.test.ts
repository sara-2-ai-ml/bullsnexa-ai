import { describe, expect, it } from "vitest";

import {
  MockProvider,
  createDefaultToolRegistry,
  runCampaignAgent,
  type AgentAction,
  type AgentProvider,
} from "../src/agent/index.js";
import { createLaunchPlan, evaluateReadiness, syntheticRulesConfig } from "../src/domain/index.js";

const today = "2026-01-15";

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

function decide(input: unknown) {
  const evaluation = evaluateReadiness(input, syntheticRulesConfig, today);
  if (!evaluation.ok) throw new Error(evaluation.error.code);
  return evaluation.decision;
}

function script(actions: AgentAction[]): AgentProvider {
  let index = 0;
  return {
    mode: "script",
    async decideNextAction() {
      return actions[Math.min(index++, actions.length - 1)]!;
    },
  };
}

const call = (toolName: string): AgentAction => ({ type: "CALL_TOOL", toolName, arguments: {} });

describe("createLaunchPlan", () => {
  it("derives schedule, budget and KPI from the validated brief", () => {
    const result = createLaunchPlan(brief, decide(brief));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { plan } = result;

    expect(plan.readinessStatus).toBe("READY");
    expect(plan.schedule).toEqual({ startDate: "2026-06-01", endDate: "2026-06-30", durationDays: 30 });
    expect(plan.budget.total).toBe(25_000);
    expect(plan.budget.dailyBudget).toBe(833.33);
    expect(plan.budget.allocationBasis).toBe("EQUAL_SPLIT_PLACEHOLDER");
    expect(plan.kpi).toEqual({ metric: "purchases", targetValue: 500 });
    expect(plan.approval.humanReviewRequired).toBe(false);
    expect(plan.summary).toContain("Synthetic Spring Launch");
    expect(plan.notice).toMatch(/nothing is published/);
  });

  it("splits the budget exactly, to the cent, with no invented money", () => {
    const odd = { ...brief, budgetAmount: 100.01, channels: ["search", "social", "video"] };
    const result = createLaunchPlan(odd, decide(odd));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cents = result.plan.budget.channels.map((entry) => Math.round(entry.amount * 100));
    expect(cents.reduce((sum, value) => sum + value, 0)).toBe(10_001);
    expect(Math.max(...cents) - Math.min(...cents)).toBeLessThanOrEqual(1);
  });

  it("counts a one-day campaign as one day and ignores duplicate channels", () => {
    const oneDay = { ...brief, endDate: "2026-06-01", channels: ["search", "search"] };
    const result = createLaunchPlan(oneDay, decide(oneDay));
    expect(result.ok && result.plan.schedule.durationDays).toBe(1);
    expect(result.ok && result.plan.budget.channels).toHaveLength(1);
  });

  it("is deterministic and independent of key order", () => {
    const reordered = Object.fromEntries(Object.entries(brief).reverse());
    expect(JSON.stringify(createLaunchPlan(reordered, decide(brief)))).toBe(
      JSON.stringify(createLaunchPlan(brief, decide(brief))),
    );
  });

  it("requires approval and lists open items for NEEDS_REVIEW campaigns", () => {
    const review = { ...brief, budgetAmount: 150_000 };
    const result = createLaunchPlan(review, decide(review));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.readinessStatus).toBe("NEEDS_REVIEW");
    expect(result.plan.approval.humanReviewRequired).toBe(true);
    expect(result.plan.approval.reasons).toContain("HIGH_BUDGET_REVIEW");
    expect(result.plan.checklist.some((item) => item.required)).toBe(true);
  });

  it("returns no plan for BLOCKED campaigns or briefs that do not fully validate", () => {
    const blocked = { ...brief, budgetAmount: -5 };
    expect(createLaunchPlan(blocked, decide(blocked))).toEqual({
      ok: false,
      reason: "BLOCKED_CAMPAIGN_HAS_NO_PLAN",
    });

    const unsupported = { ...brief, channels: ["search", "carrier_pigeon"] };
    expect(createLaunchPlan(unsupported, decide(unsupported))).toEqual({
      ok: false,
      reason: "BRIEF_NOT_FULLY_VALID",
    });
  });
});

describe("createLaunchPlan tool", () => {
  const registry = createDefaultToolRegistry();

  it("is registered, authorized and takes no arguments from the model", async () => {
    const tool = registry.get("createLaunchPlan");
    expect(tool?.authorized).toBe(true);
    expect(tool?.inputSchema.safeParse({}).success).toBe(true);
    expect(tool?.inputSchema.safeParse({ budgetAmount: 1 }).success).toBe(false);

    const result = await runCampaignAgent({
      brief,
      today,
      provider: script([call("checkCampaignFields"), call("evaluateCampaignReadiness"), { type: "CALL_TOOL", toolName: "createLaunchPlan", arguments: { budgetAmount: 1 } }]),
    });
    expect(result.error?.code).toBe("INVALID_TOOL_ARGUMENTS");
  });

  it("produces the plan after evaluation and still fits the default tool limit with search", async () => {
    const result = await runCampaignAgent({
      brief,
      today,
      provider: script([
        call("checkCampaignFields"),
        call("evaluateCampaignReadiness"),
        call("createLaunchPlan"),
        { type: "FINISH" },
      ]),
    });

    expect(result.executionStatus).toBe("COMPLETED");
    const planResult = result.toolResults.find((entry) => entry.toolName === "createLaunchPlan");
    expect(planResult?.success).toBe(true);
    expect((planResult?.output as { ok: boolean }).ok).toBe(true);

    const withSearch = await runCampaignAgent({
      brief,
      today,
      provider: script([
        call("checkCampaignFields"),
        { type: "CALL_TOOL", toolName: "searchCampaignPolicies", arguments: { query: "budget review" } },
        call("evaluateCampaignReadiness"),
        call("createLaunchPlan"),
        { type: "FINISH" },
      ]),
    });
    expect(withSearch.executionStatus).toBe("COMPLETED");
    expect(withSearch.error).toBeUndefined();
  });

  it("cannot run before an evaluation exists, and the model cannot choose the plan", async () => {
    const early = await runCampaignAgent({
      brief,
      today,
      provider: script([call("checkCampaignFields"), call("createLaunchPlan")]),
    });
    expect(early.executionStatus).toBe("FAILED");
    expect(early.error?.code).toBe("TOOL_EXECUTION_FAILURE");
    expect(early.finalDecision).toBeUndefined();

    const blocked = await runCampaignAgent({
      brief: { ...brief, budgetAmount: -5 },
      today,
      provider: script([call("checkCampaignFields"), call("evaluateCampaignReadiness"), call("createLaunchPlan"), { type: "FINISH" }]),
    });
    const output = blocked.toolResults.find((entry) => entry.toolName === "createLaunchPlan")?.output as { ok: boolean; reason: string };
    expect(output).toEqual({ ok: false, reason: "BLOCKED_CAMPAIGN_HAS_NO_PLAN" });
    expect(blocked.finalDecision?.status).toBe("BLOCKED");
  });

  it("does not change what the mock provider does or decides", async () => {
    const result = await runCampaignAgent({ brief, today, provider: new MockProvider() });
    expect(result.finalDecision?.status).toBe("READY");
    expect(result.toolResults.map((entry) => entry.toolName)).not.toContain("createLaunchPlan");
  });
});
