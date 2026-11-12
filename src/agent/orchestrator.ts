import { randomUUID } from "node:crypto";

import { z } from "zod";

import { syntheticRulesConfig, type SyntheticRulesConfig } from "../domain/rules-config.js";
import {
  EvaluationResultSchema,
  type CampaignReadinessDecision,
  type ClarificationQuestion,
} from "../domain/schemas.js";
import {
  AgentActionSchema,
  AgentStateSchema,
  ExecutionEventSchema,
  type AgentError,
  type AgentProvider,
  type AgentResult,
  type AgentState,
  type ExecutionEvent,
  type ProviderContext,
} from "./contracts.js";
import {
  CHECK_CAMPAIGN_FIELDS,
  EVALUATE_CAMPAIGN_READINESS,
  createDefaultToolRegistry,
  type CheckCampaignFieldsResult,
  type EvaluateCampaignReadinessResult,
  type ToolRegistry,
} from "./tools.js";

export interface RunAgentOptions {
  readonly brief: unknown;
  readonly today: string;
  readonly provider: AgentProvider;
  readonly config?: SyntheticRulesConfig;
  readonly toolRegistry?: ToolRegistry;
  readonly maxPlanningSteps?: number;
  readonly maxToolCalls?: number;
}

const positiveIntegerSchema = z.number().int().positive();

export function initializeAgentState(
  brief: unknown,
  today: string,
): AgentState {
  const runId = randomUUID();
  const traceId = randomUUID();
  return AgentStateSchema.parse({
    runId,
    traceId,
    executionStatus: "CREATED",
    stepCount: 0,
    currentBrief: structuredClone(brief),
    today,
    toolResults: [],
    executionHistory: [],
    clarificationQuestions: [],
  });
}

function providerContext(state: AgentState): ProviderContext {
  return structuredClone({
    runId: state.runId,
    traceId: state.traceId,
    executionStatus: state.executionStatus,
    stepCount: state.stepCount,
    currentBrief: state.currentBrief,
    today: state.today,
    toolResults: state.toolResults,
    executionHistory: state.executionHistory,
    clarificationQuestions: state.clarificationQuestions,
    ...(state.finalDecision ? { finalDecision: state.finalDecision } : {}),
  });
}

function addEvent(
  state: AgentState,
  event: Omit<ExecutionEvent, "runId" | "traceId" | "step">,
): void {
  state.executionHistory.push(
    ExecutionEventSchema.parse({
      runId: state.runId,
      traceId: state.traceId,
      step: state.stepCount,
      ...event,
    }),
  );
}

function decisionSummary(decision: CampaignReadinessDecision): string {
  if (decision.status === "READY") {
    return `Campaign is READY for planning or handoff with readiness score ${decision.score}.`;
  }

  if (decision.status === "BLOCKED") {
    const blockers = decision.validationIssues
      .filter((issue) => issue.severity === "BLOCKER")
      .map((issue) => issue.explanation);
    return `Campaign is BLOCKED: ${blockers.join(" ")}`;
  }

  const reviews = decision.validationIssues
    .filter(
      (issue) =>
        issue.severity === "REVIEW_REQUIRED" || issue.severity === "WARNING",
    )
    .map((issue) => issue.explanation);
  return `Campaign NEEDS_REVIEW: ${reviews.join(" ")}`;
}

function clarificationSummary(questions: readonly ClarificationQuestion[]): string {
  return `Campaign needs clarification: ${questions
    .map((question) => question.question)
    .join(" ")}`;
}

function result(state: AgentState, summary: string): AgentResult {
  return { ...structuredClone(state), summary };
}

function fail(
  state: AgentState,
  error: AgentError,
  toolName?: string,
): AgentResult {
  state.executionStatus = "FAILED";
  state.error = error;
  addEvent(state, {
    eventType: "AGENT_FAILED",
    outcome: "failed",
    errorCode: error.code,
    ...(toolName ? { toolName } : {}),
  });
  return result(
    state,
    `Agent execution failed safely (${error.code}); no business readiness decision was produced.`,
  );
}

function latestFieldInspection(
  state: AgentState,
): CheckCampaignFieldsResult | undefined {
  return [...state.toolResults]
    .reverse()
    .find(
      (toolResult) =>
        toolResult.success && toolResult.toolName === CHECK_CAMPAIGN_FIELDS,
    )?.output as CheckCampaignFieldsResult | undefined;
}

export async function runCampaignAgent(
  options: RunAgentOptions,
): Promise<AgentResult> {
  const config = options.config ?? syntheticRulesConfig;
  const registry = options.toolRegistry ?? createDefaultToolRegistry();
  const maxPlanningSteps = positiveIntegerSchema.parse(
    options.maxPlanningSteps ?? 6,
  );
  const maxToolCalls = positiveIntegerSchema.parse(options.maxToolCalls ?? 2);
  const state = initializeAgentState(options.brief, options.today);
  const executedToolActions = new Set<string>();
  let toolCallCount = 0;

  addEvent(state, { eventType: "AGENT_STARTED", outcome: "started" });

  while (state.stepCount < maxPlanningSteps) {
    state.executionStatus = "PLANNING";
    state.stepCount += 1;

    let rawAction: unknown;
    try {
      rawAction = await options.provider.decideNextAction(providerContext(state));
    } catch {
      return fail(state, {
        code: "PROVIDER_FAILURE",
        message: "The provider could not produce a next action.",
      });
    }

    const parsedAction = AgentActionSchema.safeParse(rawAction);
    if (!parsedAction.success) {
      return fail(state, {
        code: "INVALID_PROVIDER_ACTION",
        message: "The provider proposed an action that failed strict validation.",
      });
    }
    const action = parsedAction.data;
    addEvent(state, {
      eventType: "ACTION_PROPOSED",
      outcome: action.type,
      ...(action.type === "CALL_TOOL" ? { toolName: action.toolName } : {}),
    });

    if (action.type === "REFUSE") {
      state.executionStatus = "REFUSED";
      state.error = {
        code: "PROVIDER_REFUSED",
        message: "The provider refused to continue safely.",
      };
      addEvent(state, { eventType: "AGENT_REFUSED", outcome: "refused" });
      return result(state, "Agent execution was refused safely.");
    }

    if (action.type === "ASK_USER") {
      const inspection = latestFieldInspection(state);
      const hasBlocker = inspection?.issues.some(
        (issue) => issue.severity === "BLOCKER",
      );
      if (hasBlocker) {
        return fail(state, {
          code: "BLOCKER_REQUIRES_EVALUATION",
          message:
            "A known blocker must be evaluated before requesting clarification.",
        });
      }
      if (!inspection || inspection.canEvaluate) {
        return fail(state, {
          code: "INVALID_CLARIFICATION_ROUTING",
          message:
            "Clarification is valid only after an insufficient field inspection.",
        });
      }
      state.executionStatus = "WAITING_FOR_CLARIFICATION";
      state.clarificationQuestions = [...inspection.clarificationQuestions];
      addEvent(state, {
        eventType: "CLARIFICATION_REQUESTED",
        outcome: "waiting_for_clarification",
      });
      return result(state, clarificationSummary(state.clarificationQuestions));
    }

    if (action.type === "FINISH") {
      const evaluationOutput = [...state.toolResults]
        .reverse()
        .find(
          (toolResult) =>
            toolResult.success &&
            toolResult.toolName === EVALUATE_CAMPAIGN_READINESS,
        )?.output as EvaluateCampaignReadinessResult | undefined;
      const evaluation = EvaluationResultSchema.safeParse(
        evaluationOutput?.evaluation,
      );
      if (!evaluation.success || !evaluation.data.ok) {
        return fail(state, {
          code: "FINISH_REQUIRES_EVALUATION",
          message:
            "FINISH requires a successful authoritative readiness evaluation.",
        });
      }
      state.finalDecision = evaluation.data.decision;
      state.executionStatus = "COMPLETED";
      addEvent(state, { eventType: "AGENT_COMPLETED", outcome: "completed" });
      return result(state, decisionSummary(state.finalDecision));
    }

    const toolActionKey = `${action.toolName}:${JSON.stringify(action.arguments)}`;
    if (executedToolActions.has(toolActionKey)) {
      return fail(
        state,
        {
          code: "REPEATED_ACTION",
          message: "The provider repeated a tool action without making progress.",
        },
        action.toolName,
      );
    }
    if (toolCallCount >= maxToolCalls) {
      return fail(
        state,
        {
          code: "MAX_TOOL_CALLS_EXCEEDED",
          message: "The agent reached its configured tool-call limit.",
        },
        action.toolName,
      );
    }

    const tool = registry.get(action.toolName);
    if (!tool) {
      return fail(
        state,
        {
          code: "UNKNOWN_TOOL",
          message: "The provider requested an unknown tool.",
        },
        action.toolName,
      );
    }
    if (!tool.authorized) {
      return fail(
        state,
        {
          code: "UNAUTHORIZED_TOOL",
          message: "The requested tool is not authorized for this agent.",
        },
        action.toolName,
      );
    }
    if (
      tool.name === EVALUATE_CAMPAIGN_READINESS &&
      !latestFieldInspection(state)
    ) {
      return fail(
        state,
        {
          code: "TOOL_PRECONDITION_FAILED",
          message:
            "Readiness evaluation requires a successful field inspection first.",
        },
        tool.name,
      );
    }

    const parsedArguments = tool.inputSchema.safeParse(action.arguments);
    if (!parsedArguments.success) {
      return fail(
        state,
        {
          code: "INVALID_TOOL_ARGUMENTS",
          message: "The provider supplied invalid tool arguments.",
        },
        action.toolName,
      );
    }

    state.executionStatus = "TOOL_RUNNING";
    toolCallCount += 1;
    executedToolActions.add(toolActionKey);
    addEvent(state, {
      eventType: "TOOL_STARTED",
      toolName: tool.name,
      outcome: "started",
    });

    let output: unknown;
    try {
      output = await tool.execute({ state, config });
    } catch {
      const toolError = {
        code: "TOOL_EXECUTION_FAILURE",
        message: "The authorized tool failed during execution.",
      } as const;
      state.toolResults.push({
        toolName: tool.name,
        success: false,
        error: toolError,
      });
      addEvent(state, {
        eventType: "TOOL_FAILED",
        toolName: tool.name,
        outcome: "failed",
        errorCode: toolError.code,
      });
      return fail(state, toolError, tool.name);
    }

    state.toolResults.push({ toolName: tool.name, success: true, output });
    addEvent(state, {
      eventType: "TOOL_SUCCEEDED",
      toolName: tool.name,
      outcome: "succeeded",
    });

    if (tool.name === EVALUATE_CAMPAIGN_READINESS) {
      const evaluation = EvaluationResultSchema.safeParse(
        (output as EvaluateCampaignReadinessResult | undefined)?.evaluation,
      );
      if (!evaluation.success) {
        return fail(
          state,
          {
            code: "INVALID_TOOL_RESULT",
            message: "The readiness tool returned an invalid result.",
          },
          tool.name,
        );
      }
      if (!evaluation.data.ok) {
        return fail(state, evaluation.data.error, tool.name);
      }
    }
  }

  return fail(state, {
    code: "MAX_PLANNING_STEPS_EXCEEDED",
    message: "The agent reached its configured planning-step limit.",
  });
}
