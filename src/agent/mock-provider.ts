import type {
  AgentAction,
  AgentProvider,
  ProviderContext,
} from "./contracts.js";
import {
  CHECK_CAMPAIGN_FIELDS,
  EVALUATE_CAMPAIGN_READINESS,
  type CheckCampaignFieldsResult,
  type EvaluateCampaignReadinessResult,
} from "./tools.js";

function successfulOutput<T>(
  context: ProviderContext,
  toolName: string,
): T | undefined {
  return [...context.toolResults]
    .reverse()
    .find((result) => result.toolName === toolName && result.success)?.output as
    | T
    | undefined;
}

export class MockProvider implements AgentProvider {
  readonly mode = "mock";
  readonly retrySafe = true;

  async decideNextAction(
    context: ProviderContext,
    signal: AbortSignal,
  ): Promise<AgentAction> {
    signal.throwIfAborted();
    const evaluation = successfulOutput<EvaluateCampaignReadinessResult>(
      context,
      EVALUATE_CAMPAIGN_READINESS,
    );
    if (evaluation?.evaluation.ok) {
      return { type: "FINISH" };
    }

    const inspection = successfulOutput<CheckCampaignFieldsResult>(
      context,
      CHECK_CAMPAIGN_FIELDS,
    );
    if (!inspection) {
      return {
        type: "CALL_TOOL",
        toolName: CHECK_CAMPAIGN_FIELDS,
        arguments: {},
      };
    }

    const hasBlocker = inspection.issues.some(
      (issue) => issue.severity === "BLOCKER",
    );
    if (hasBlocker || inspection.canEvaluate) {
      return {
        type: "CALL_TOOL",
        toolName: EVALUATE_CAMPAIGN_READINESS,
        arguments: {},
      };
    }

    return {
      type: "ASK_USER",
      questions: [...inspection.clarificationQuestions],
    };
  }
}
