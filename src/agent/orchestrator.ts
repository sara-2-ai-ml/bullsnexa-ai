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
  DEFAULT_MAX_RETRIES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DEFAULT_TOOL_TIMEOUT_MS,
  OperationAttemptFailure,
  runOperationAttempt,
} from "./reliability.js";
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
  readonly providerTimeoutMs?: number;
  readonly toolTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly signal?: AbortSignal;
}

/** Three business tools plus one spare call for a bounded re-check. */
export const DEFAULT_MAX_TOOL_CALLS = 4;

const positiveIntegerSchema = z.number().int().finite().positive();
const nonnegativeIntegerSchema = z.number().int().finite().nonnegative();

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

function canRetry(
  failure: OperationAttemptFailure,
  retrySafe: boolean,
  attempt: number,
  maxRetries: number,
): boolean {
  return (
    failure.transient &&
    failure.boundary === undefined &&
    retrySafe &&
    attempt <= maxRetries
  );
}

function providerTerminalError(
  failure: OperationAttemptFailure,
  retrySafe: boolean,
): AgentError {
  if (failure.boundary === "timeout") {
    return {
      code: "PROVIDER_TIMEOUT",
      message: "The provider exceeded the per-operation timeout.",
    };
  }
  if (failure.boundary === "cancellation") {
    return {
      code: "PROVIDER_CANCELLED",
      message: "The provider operation was cancelled.",
    };
  }
  if (failure.transient) {
    if (!retrySafe) {
      return {
        code: "PROVIDER_TRANSIENT_FAILURE_NOT_RETRIED",
        message: "The transient provider failure was not safe to retry.",
      };
    }
    return {
      code: "PROVIDER_RETRY_EXHAUSTED",
      message: "The provider exhausted its bounded transient retry budget.",
    };
  }
  return {
    code: "PROVIDER_FAILURE",
    message: "The provider could not produce a next action.",
  };
}

function toolTerminalError(
  failure: OperationAttemptFailure,
  idempotent: boolean,
): AgentError {
  if (failure.boundary === "timeout") {
    return {
      code: "TOOL_TIMEOUT",
      message: "The authorized tool exceeded the per-operation timeout.",
    };
  }
  if (failure.boundary === "cancellation") {
    return {
      code: "TOOL_CANCELLED",
      message: "The authorized tool operation was cancelled.",
    };
  }
  if (failure.transient) {
    if (!idempotent) {
      return {
        code: "TOOL_TRANSIENT_FAILURE_NOT_RETRIED",
        message: "The transient tool failure was not safe to retry.",
      };
    }
    return {
      code: "TOOL_RETRY_EXHAUSTED",
      message: "The authorized tool exhausted its bounded transient retry budget.",
    };
  }
  return {
    code: "TOOL_EXECUTION_FAILURE",
    message: "The authorized tool failed during execution.",
  };
}

async function executeCampaignRun(
  options: RunAgentOptions,
): Promise<AgentResult> {
  const config = options.config ?? syntheticRulesConfig;
  const registry = options.toolRegistry ?? createDefaultToolRegistry();
  const maxPlanningSteps = positiveIntegerSchema.parse(
    options.maxPlanningSteps ?? 6,
  );
  const maxToolCalls = positiveIntegerSchema.parse(options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS);
  const providerTimeoutMs = positiveIntegerSchema.parse(
    options.providerTimeoutMs ??
      options.provider.defaultTimeoutMs ??
      DEFAULT_PROVIDER_TIMEOUT_MS,
  );
  const toolTimeoutMs = positiveIntegerSchema.parse(
    options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
  );
  const maxRetries = nonnegativeIntegerSchema.parse(
    options.maxRetries ?? DEFAULT_MAX_RETRIES,
  );
  const state = initializeAgentState(options.brief, options.today);
  const executedToolActions = new Set<string>();
  let toolCallCount = 0;

  addEvent(state, { eventType: "AGENT_STARTED", outcome: "started" });

  while (state.stepCount < maxPlanningSteps) {
    state.executionStatus = "PLANNING";
    state.stepCount += 1;

    let rawAction: unknown;
    let providerAttempt = 0;
    let providerDurationMs = 0;
    while (providerAttempt <= maxRetries) {
      providerAttempt += 1;
      try {
        const attemptResult = await runOperationAttempt({
          operation: (signal) =>
            options.provider.decideNextAction(providerContext(state), signal),
          timeoutMs: providerTimeoutMs,
          ...(options.signal ? { externalSignal: options.signal } : {}),
          timeoutCode: "PROVIDER_TIMEOUT",
          cancellationCode: "PROVIDER_CANCELLED",
          failureCode: "PROVIDER_FAILURE",
        });
        rawAction = attemptResult.value;
        providerDurationMs = attemptResult.durationMs;
        break;
      } catch (error) {
        if (!(error instanceof OperationAttemptFailure)) throw error;
        addEvent(state, {
          eventType: "ACTION_PROPOSED",
          outcome:
            error.boundary === "timeout"
              ? "timed_out"
              : error.boundary === "cancellation"
                ? "cancelled"
                : "failed",
          errorCode: error.code,
          durationMs: error.durationMs,
          attempt: providerAttempt,
        });
        if (
          canRetry(
            error,
            options.provider.retrySafe === true,
            providerAttempt,
            maxRetries,
          )
        ) {
          continue;
        }
        return fail(
          state,
          providerTerminalError(error, options.provider.retrySafe === true),
        );
      }
    }

    const parsedAction = AgentActionSchema.safeParse(rawAction);
    if (!parsedAction.success) {
      addEvent(state, {
        eventType: "ACTION_PROPOSED",
        outcome: "invalid",
        errorCode: "INVALID_PROVIDER_ACTION",
        durationMs: providerDurationMs,
        attempt: providerAttempt,
      });
      return fail(state, {
        code: "INVALID_PROVIDER_ACTION",
        message: "The provider proposed an action that failed strict validation.",
      });
    }
    const action = parsedAction.data;
    addEvent(state, {
      eventType: "ACTION_PROPOSED",
      outcome: action.type,
      durationMs: providerDurationMs,
      attempt: providerAttempt,
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
      attempt: 1,
    });

    let output: unknown;
    let toolAttempt = 0;
    let toolCompleted = false;
    while (toolAttempt <= maxRetries) {
      toolAttempt += 1;
      if (toolAttempt > 1) {
        addEvent(state, {
          eventType: "TOOL_STARTED",
          toolName: tool.name,
          outcome: "started",
          attempt: toolAttempt,
        });
      }
      try {
        const attemptResult = await runOperationAttempt({
          operation: (signal) =>
            tool.execute({
              state: structuredClone(state),
              config: structuredClone(config),
              signal,
              input: parsedArguments.data,
            }),
          timeoutMs: toolTimeoutMs,
          ...(options.signal ? { externalSignal: options.signal } : {}),
          timeoutCode: "TOOL_TIMEOUT",
          cancellationCode: "TOOL_CANCELLED",
          failureCode: "TOOL_EXECUTION_FAILURE",
        });
        output = attemptResult.value;
        toolCompleted = true;
        addEvent(state, {
          eventType: "TOOL_SUCCEEDED",
          toolName: tool.name,
          outcome: "succeeded",
          durationMs: attemptResult.durationMs,
          attempt: toolAttempt,
        });
        break;
      } catch (error) {
        if (!(error instanceof OperationAttemptFailure)) throw error;
        addEvent(state, {
          eventType: "TOOL_FAILED",
          toolName: tool.name,
          outcome:
            error.boundary === "timeout"
              ? "timed_out"
              : error.boundary === "cancellation"
                ? "cancelled"
                : "failed",
          errorCode: error.code,
          durationMs: error.durationMs,
          attempt: toolAttempt,
        });
        if (canRetry(error, tool.idempotent, toolAttempt, maxRetries)) {
          continue;
        }
        const toolError = toolTerminalError(error, tool.idempotent);
        state.toolResults.push({
          toolName: tool.name,
          success: false,
          error: toolError,
        });
        return fail(state, toolError, tool.name);
      }
    }

    if (!toolCompleted) {
      return fail(
        state,
        {
          code: "TOOL_EXECUTION_FAILURE",
          message: "The authorized tool did not complete.",
        },
        tool.name,
      );
    }

    state.toolResults.push({ toolName: tool.name, success: true, output });

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

export async function runCampaignAgent(
  options: RunAgentOptions,
): Promise<AgentResult> {
  const outcome = await executeCampaignRun(options);
  const usage = options.provider.usage?.();
  return {
    ...outcome,
    provider: {
      mode: options.provider.mode ?? "custom",
      ...(usage ? { usage } : {}),
    },
  };
}
