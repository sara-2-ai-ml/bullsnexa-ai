import { z, type ZodType } from "zod";

import {
  evaluateReadiness,
  inspectCampaignBrief,
  type CampaignFieldInspection,
} from "../domain/readiness.js";
import type { SyntheticRulesConfig } from "../domain/rules-config.js";
import type { EvaluationResult } from "../domain/schemas.js";
import type { AgentState } from "./contracts.js";

export const CHECK_CAMPAIGN_FIELDS = "checkCampaignFields";
export const EVALUATE_CAMPAIGN_READINESS = "evaluateCampaignReadiness";

export interface ToolExecutionContext {
  readonly state: Readonly<AgentState>;
  readonly config: SyntheticRulesConfig;
  readonly signal: AbortSignal;
}

export interface AgentToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<Record<string, never>>;
  readonly authorized: boolean;
  readonly idempotent: boolean;
  execute(context: ToolExecutionContext): Promise<unknown>;
}

export type ToolRegistry = ReadonlyMap<string, AgentToolDefinition>;

export interface CheckCampaignFieldsResult extends CampaignFieldInspection {}

export interface EvaluateCampaignReadinessResult {
  readonly evaluation: EvaluationResult;
}

const noArgumentsSchema = z.object({}).strict();

export function createDefaultToolRegistry(): ToolRegistry {
  const tools: AgentToolDefinition[] = [
    {
      name: CHECK_CAMPAIGN_FIELDS,
      description:
        "Inspect the trusted structured campaign brief using Phase 1 validation issues.",
      inputSchema: noArgumentsSchema,
      authorized: true,
      idempotent: true,
      async execute({ state, config, signal }): Promise<CheckCampaignFieldsResult> {
        signal.throwIfAborted();
        return inspectCampaignBrief(state.currentBrief, config, state.today);
      },
    },
    {
      name: EVALUATE_CAMPAIGN_READINESS,
      description:
        "Evaluate the trusted structured campaign brief with the authoritative Phase 1 engine.",
      inputSchema: noArgumentsSchema,
      authorized: true,
      idempotent: true,
      async execute({ state, config, signal }): Promise<EvaluateCampaignReadinessResult> {
        signal.throwIfAborted();
        return {
          evaluation: evaluateReadiness(
            state.currentBrief,
            config,
            state.today,
          ),
        };
      },
    },
  ];

  return new Map(tools.map((tool) => [tool.name, tool]));
}
