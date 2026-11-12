import { z } from "zod";

import { CampaignStatusSchema } from "./schemas.js";

export const EvaluationExecutionScopeSchema = z.enum([
  "READY_FOR_PHASE_1_TEST",
  "FUTURE_INTEGRATION_CASE",
]);

export const EvaluationCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  expectedOutcome: z.object({
    status: z.union([CampaignStatusSchema, z.literal("NOT_EXECUTED")]),
  }),
  expectedScoreRange: z
    .object({
      min: z.number().int().min(0).max(100),
      max: z.number().int().min(0).max(100),
    })
    .refine((range) => range.min <= range.max, {
      message: "expectedScoreRange min must not exceed max",
    })
    .optional(),
  expectedRisks: z.array(z.string().min(1)),
  expectedBehavior: z.string().min(1),
  executionScope: EvaluationExecutionScopeSchema,
});

export const CampaignEvaluationDatasetSchema = z.object({
  version: z.string().min(1),
  today: z.string().min(1),
  cases: z.array(EvaluationCaseSchema).length(15),
});

export type EvaluationExecutionScope = z.infer<
  typeof EvaluationExecutionScopeSchema
>;
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
export type CampaignEvaluationDataset = z.infer<
  typeof CampaignEvaluationDatasetSchema
>;
