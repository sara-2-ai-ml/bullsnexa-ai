import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  AgentActionSchema,
  AgentStateSchema,
  MockProvider,
  initializeAgentState,
  runCampaignAgent,
  type AgentAction,
  type AgentProvider,
  type ProviderContext,
} from "../src/agent/index.js";
import {
  CHECK_CAMPAIGN_FIELDS,
  EVALUATE_CAMPAIGN_READINESS,
  createDefaultToolRegistry,
  type CheckCampaignFieldsResult,
} from "../src/agent/tools.js";
import { inspectCampaignBrief } from "../src/domain/readiness.js";
import { syntheticRulesConfig } from "../src/domain/rules-config.js";

const TODAY = "2026-01-15";
const completeBrief = {
  campaignName: "Spring Launch",
  objective: "sales",
  targetAudience: "Sustainable retail customers",
  targetCountry: "US",
  channels: ["search", "social"],
  budgetAmount: 50_000,
  currency: "USD",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  targetKpi: { metric: "purchases", targetValue: 1_000 },
  category: "retail",
} as const;

function sequenceProvider(...actions: AgentAction[]): AgentProvider {
  let index = 0;
  return {
    async decideNextAction(): Promise<AgentAction> {
      const action = actions[index];
      index += 1;
      if (!action) throw new Error("No action configured");
      return action;
    },
  };
}

function unsafeProvider(action: unknown): AgentProvider {
  return {
    async decideNextAction(): Promise<AgentAction> {
      return action as AgentAction;
    },
  };
}

describe("agent contracts and field inspection", () => {
  it("initializes valid typed execution state", () => {
    const state = initializeAgentState(completeBrief, TODAY);
    expect(AgentStateSchema.parse(state)).toEqual(state);
    expect(state.executionStatus).toBe("CREATED");
    expect(state.stepCount).toBe(0);
    expect(state.toolResults).toEqual([]);
  });

  it("strictly rejects unexpected provider action properties", () => {
    expect(
      AgentActionSchema.safeParse({ type: "FINISH", summary: "trust me" })
        .success,
    ).toBe(false);
    expect(
      AgentActionSchema.safeParse({
        type: "CALL_TOOL",
        toolName: CHECK_CAMPAIGN_FIELDS,
        arguments: {},
        override: true,
      }).success,
    ).toBe(false);
  });

  it("exposes authoritative Phase 1 issue codes and severities without status or score", () => {
    const inspection = inspectCampaignBrief(
      { ...completeBrief, budgetAmount: -1 },
      syntheticRulesConfig,
      TODAY,
    );
    expect(inspection.issues).toContainEqual(
      expect.objectContaining({
        code: "INVALID_BUDGET",
        severity: "BLOCKER",
      }),
    );
    expect(inspection.canEvaluate).toBe(true);
    expect(inspection).not.toHaveProperty("status");
    expect(inspection).not.toHaveProperty("score");
  });

  it("marks missing and structurally invalid required fields for clarification", () => {
    const inspection = inspectCampaignBrief(
      { campaignName: 42 },
      syntheticRulesConfig,
      TODAY,
    );
    expect(inspection.missingFields).toContain("objective");
    expect(inspection.invalidFields).toContain("campaignName");
    expect(inspection.canEvaluate).toBe(false);
  });
});

describe("MockProvider integration", () => {
  it("uses the field result to select the evaluator for a complete brief", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
    });
    expect(result.executionStatus).toBe("COMPLETED");
    expect(result.finalDecision?.status).toBe("READY");
    expect(result.toolResults.map((item) => item.toolName)).toEqual([
      CHECK_CAMPAIGN_FIELDS,
      EVALUATE_CAMPAIGN_READINESS,
    ]);
    const inspection = result.toolResults[0]?.output as CheckCampaignFieldsResult;
    expect(inspection.canEvaluate).toBe(true);
  });

  it("asks authoritative questions after the field result shows an incomplete brief", async () => {
    const result = await runCampaignAgent({
      brief: { campaignName: "Draft" },
      today: TODAY,
      provider: new MockProvider(),
    });
    expect(result.executionStatus).toBe("WAITING_FOR_CLARIFICATION");
    expect(result.finalDecision).toBeUndefined();
    expect(result.clarificationQuestions.length).toBeGreaterThan(0);
    expect(result.toolResults.map((item) => item.toolName)).toEqual([
      CHECK_CAMPAIGN_FIELDS,
    ]);
  });

  it("routes a supplied negative budget to the evaluator and preserves BLOCKED", async () => {
    const result = await runCampaignAgent({
      brief: { ...completeBrief, budgetAmount: -500 },
      today: TODAY,
      provider: new MockProvider(),
    });
    expect(result.executionStatus).toBe("COMPLETED");
    expect(result.finalDecision?.status).toBe("BLOCKED");
    expect(result.finalDecision?.validationIssues).toContainEqual(
      expect.objectContaining({ code: "INVALID_BUDGET", severity: "BLOCKER" }),
    );
  });

  it("gives a blocker precedence over simultaneous missing-field clarification", async () => {
    const { objective: _objective, ...withoutObjective } = completeBrief;
    const result = await runCampaignAgent({
      brief: { ...withoutObjective, budgetAmount: -10 },
      today: TODAY,
      provider: new MockProvider(),
    });
    expect(result.executionStatus).toBe("COMPLETED");
    expect(result.finalDecision?.status).toBe("BLOCKED");
    expect(result.toolResults).toHaveLength(2);
  });

  it("turns an invalid evaluation date into technical FAILED with no decision", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: "2026-02-30",
      provider: new MockProvider(),
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("INVALID_EVALUATION_DATE");
    expect(result.finalDecision).toBeUndefined();
    expect(result.summary).not.toContain("readiness score");
  });

  it("preserves a NEEDS_REVIEW decision from the domain evaluator", async () => {
    const result = await runCampaignAgent({
      brief: {
        ...completeBrief,
        objective: "leads",
        targetCountry: "DE",
        currency: "EUR",
        targetKpi: { metric: "leads", targetValue: 500 },
      },
      today: TODAY,
      provider: new MockProvider(),
    });
    expect(result.executionStatus).toBe("COMPLETED");
    expect(result.finalDecision?.status).toBe("NEEDS_REVIEW");
    expect(result.finalDecision?.requiresHumanReview).toBe(true);
  });

  it("creates deterministic summaries from verified decisions", async () => {
    const first = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
    });
    const second = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
    });
    expect(first.summary).toBe(second.summary);
    expect(first.summary).toContain("READY");
  });

  it("records a minimal correlated trace without campaign input data", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
    });
    expect(result.executionHistory.map((event) => event.eventType)).toEqual([
      "AGENT_STARTED",
      "ACTION_PROPOSED",
      "TOOL_STARTED",
      "TOOL_SUCCEEDED",
      "ACTION_PROPOSED",
      "TOOL_STARTED",
      "TOOL_SUCCEEDED",
      "ACTION_PROPOSED",
      "AGENT_COMPLETED",
    ]);
    expect(
      result.executionHistory.every(
        (event) =>
          event.runId === result.runId && event.traceId === result.traceId,
      ),
    ).toBe(true);
    expect(JSON.stringify(result.executionHistory)).not.toContain(
      completeBrief.targetAudience,
    );
  });
});

describe("orchestration safety boundaries", () => {
  it("rejects an unknown tool", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: sequenceProvider({
        type: "CALL_TOOL",
        toolName: "deleteEverything",
        arguments: {},
      }),
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("UNKNOWN_TOOL");
  });

  it("rejects a registered but unauthorized tool", async () => {
    const registry = new Map(createDefaultToolRegistry());
    const checkTool = registry.get(CHECK_CAMPAIGN_FIELDS);
    if (!checkTool) throw new Error("Missing default check tool");
    registry.set(CHECK_CAMPAIGN_FIELDS, {
      ...checkTool,
      authorized: false,
    });
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
      toolRegistry: registry,
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("UNAUTHORIZED_TOOL");
  });

  it("rejects extra tool arguments and provider-controlled brief changes", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: sequenceProvider({
        type: "CALL_TOOL",
        toolName: CHECK_CAMPAIGN_FIELDS,
        arguments: { budgetAmount: -1 },
      }),
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("INVALID_TOOL_ARGUMENTS");
    expect(result.toolResults).toEqual([]);
  });

  it("isolates trusted state from direct provider-context mutation", async () => {
    const mock = new MockProvider();
    const mutatingProvider: AgentProvider = {
      async decideNextAction(context: ProviderContext): Promise<AgentAction> {
        (context.currentBrief as { budgetAmount: number }).budgetAmount = -99;
        return mock.decideNextAction(context, new AbortController().signal);
      },
    };
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: mutatingProvider,
    });
    expect(result.executionStatus).toBe("COMPLETED");
    expect(result.finalDecision?.status).toBe("READY");
  });

  it("fails malformed provider output instead of accepting false success", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: unsafeProvider({ type: "FINISH", summary: "launched" }),
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("INVALID_PROVIDER_ACTION");
  });

  it("stops safely when the provider refuses", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: sequenceProvider({
        type: "REFUSE",
        reason: "Unable to proceed safely.",
      }),
    });
    expect(result.executionStatus).toBe("REFUSED");
    expect(result.finalDecision).toBeUndefined();
    expect(result.executionHistory.at(-1)?.eventType).toBe("AGENT_REFUSED");
  });

  it("requires a successful evaluator call before FINISH", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: sequenceProvider({ type: "FINISH" }),
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("FINISH_REQUIRES_EVALUATION");
  });

  it("requires field inspection before readiness evaluation", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: sequenceProvider({
        type: "CALL_TOOL",
        toolName: EVALUATE_CAMPAIGN_READINESS,
        arguments: {},
      }),
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("TOOL_PRECONDITION_FAILED");
  });

  it("enforces the maximum planning-step limit", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
      maxPlanningSteps: 1,
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("MAX_PLANNING_STEPS_EXCEEDED");
  });

  it("enforces the maximum total tool-call limit", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
      maxToolCalls: 1,
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("MAX_TOOL_CALLS_EXCEEDED");
  });

  it("detects repeated tool actions", async () => {
    const repeatedProvider = unsafeProvider({
      type: "CALL_TOOL",
      toolName: CHECK_CAMPAIGN_FIELDS,
      arguments: {},
    });
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: repeatedProvider,
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("REPEATED_ACTION");
  });

  it("handles provider exceptions safely", async () => {
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: {
        async decideNextAction(): Promise<AgentAction> {
          throw new Error("sensitive provider detail");
        },
      },
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error).toEqual({
      code: "PROVIDER_FAILURE",
      message: "The provider could not produce a next action.",
    });
  });

  it("handles tool exceptions safely", async () => {
    const registry = new Map(createDefaultToolRegistry());
    const checkTool = registry.get(CHECK_CAMPAIGN_FIELDS);
    if (!checkTool) throw new Error("Missing default check tool");
    registry.set(CHECK_CAMPAIGN_FIELDS, {
      ...checkTool,
      inputSchema: z.object({}).strict(),
      async execute(): Promise<never> {
        throw new Error("sensitive tool detail");
      },
    });
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
      toolRegistry: registry,
    });
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("TOOL_EXECUTION_FAILURE");
    expect(result.summary).not.toContain("sensitive tool detail");
  });
});
