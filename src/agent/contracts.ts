import { z } from "zod";

import {
  CampaignReadinessDecisionSchema,
  ClarificationQuestionSchema,
  type CampaignReadinessDecision,
  type ClarificationQuestion,
} from "../domain/schemas.js";

export const AgentExecutionStatusSchema = z.enum([
  "CREATED",
  "PLANNING",
  "TOOL_RUNNING",
  "WAITING_FOR_CLARIFICATION",
  "COMPLETED",
  "FAILED",
  "REFUSED",
]);

export const AgentActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("CALL_TOOL"),
      toolName: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("ASK_USER"),
      questions: z.array(ClarificationQuestionSchema).min(1),
    })
    .strict(),
  z.object({ type: z.literal("FINISH") }).strict(),
  z
    .object({
      type: z.literal("REFUSE"),
      reason: z.string().min(1),
    })
    .strict(),
]);

export const AgentErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const ExecutionEventSchema = z
  .object({
    runId: z.string().uuid(),
    traceId: z.string().uuid(),
    step: z.number().int().nonnegative(),
    eventType: z.enum([
      "AGENT_STARTED",
      "ACTION_PROPOSED",
      "TOOL_STARTED",
      "TOOL_SUCCEEDED",
      "TOOL_FAILED",
      "CLARIFICATION_REQUESTED",
      "AGENT_COMPLETED",
      "AGENT_REFUSED",
      "AGENT_FAILED",
    ]),
    toolName: z.string().min(1).optional(),
    outcome: z.string().min(1),
    errorCode: z.string().min(1).optional(),
  })
  .strict();

export const ToolResultRecordSchema = z
  .object({
    toolName: z.string().min(1),
    success: z.boolean(),
    output: z.unknown().optional(),
    error: AgentErrorSchema.optional(),
  })
  .strict();

export const AgentStateSchema = z
  .object({
    runId: z.string().uuid(),
    traceId: z.string().uuid(),
    executionStatus: AgentExecutionStatusSchema,
    stepCount: z.number().int().nonnegative(),
    currentBrief: z.unknown(),
    today: z.string(),
    toolResults: z.array(ToolResultRecordSchema),
    executionHistory: z.array(ExecutionEventSchema),
    finalDecision: CampaignReadinessDecisionSchema.optional(),
    clarificationQuestions: z.array(ClarificationQuestionSchema),
    error: AgentErrorSchema.optional(),
  })
  .strict();

export type AgentExecutionStatus = z.infer<typeof AgentExecutionStatusSchema>;
export type AgentAction = z.infer<typeof AgentActionSchema>;
export type AgentError = z.infer<typeof AgentErrorSchema>;
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;
export type ToolResultRecord = z.infer<typeof ToolResultRecordSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;

export interface AgentResult extends AgentState {
  readonly summary: string;
}

export interface ProviderContext {
  readonly runId: string;
  readonly traceId: string;
  readonly executionStatus: AgentExecutionStatus;
  readonly stepCount: number;
  readonly currentBrief: unknown;
  readonly today: string;
  readonly toolResults: readonly ToolResultRecord[];
  readonly executionHistory: readonly ExecutionEvent[];
  readonly clarificationQuestions: readonly ClarificationQuestion[];
  readonly finalDecision?: CampaignReadinessDecision;
}

export interface AgentProvider {
  decideNextAction(context: ProviderContext): Promise<AgentAction>;
}
