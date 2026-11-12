import { z } from "zod";

export const ObjectiveSchema = z.enum([
  "leads",
  "sales",
  "awareness",
  "traffic",
  "app_installs",
]);

export const KpiMetricSchema = z.enum([
  "leads",
  "cost_per_lead",
  "purchases",
  "revenue",
  "return_on_ad_spend",
  "impressions",
  "reach",
  "clicks",
  "sessions",
  "installs",
  "cost_per_install",
]);

export const ChannelSchema = z.enum([
  "search",
  "social",
  "display",
  "email",
  "video",
]);

export const CurrencySchema = z.enum(["USD", "EUR", "GBP"]);

export const TargetKpiSchema = z
  .object({
    metric: KpiMetricSchema,
    targetValue: z.number().finite().positive(),
  })
  .strict();

export function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));

  return (
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day
  );
}

export const IsoDateSchema = z.string().refine(isIsoCalendarDate, {
  message: "Expected a valid ISO calendar date in YYYY-MM-DD format",
});

export const TargetCountrySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{2}$/.test(value), {
    message: "Expected an ISO 3166-1 alpha-2 country code",
  });

const NonEmptyTextSchema = z.string().trim().min(1);

export const PartialCampaignBriefSchema = z
  .object({
    campaignName: NonEmptyTextSchema.optional(),
    objective: ObjectiveSchema.optional(),
    targetAudience: NonEmptyTextSchema.optional(),
    targetCountry: TargetCountrySchema.optional(),
    channels: z.array(ChannelSchema).min(1).optional(),
    budgetAmount: z.number().optional(),
    currency: CurrencySchema.optional(),
    startDate: IsoDateSchema.optional(),
    endDate: IsoDateSchema.optional(),
    targetKpi: TargetKpiSchema.optional(),
    additionalNotes: z.string().optional(),
    category: NonEmptyTextSchema.optional(),
  })
  .strict();

export const ValidatedCampaignBriefSchema = z
  .object({
    campaignName: NonEmptyTextSchema,
    objective: ObjectiveSchema,
    targetAudience: NonEmptyTextSchema,
    targetCountry: TargetCountrySchema,
    channels: z.array(ChannelSchema).min(1),
    budgetAmount: z.number().finite().positive(),
    currency: CurrencySchema,
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    targetKpi: TargetKpiSchema,
    additionalNotes: z.string().optional(),
    category: NonEmptyTextSchema,
  })
  .strict();

export const IssueSeveritySchema = z.enum([
  "INFO",
  "WARNING",
  "REVIEW_REQUIRED",
  "BLOCKER",
]);

export const CampaignStatusSchema = z.enum([
  "READY",
  "NEEDS_REVIEW",
  "BLOCKED",
]);

export const ValidationIssueSchema = z.object({
  code: z.string().min(1),
  fieldPath: z.string().min(1),
  severity: IssueSeveritySchema,
  explanation: z.string().min(1),
  suggestedAction: z.string().min(1),
  policyRef: z.string().min(1).optional(),
});

export const CampaignRiskSchema = z.object({
  code: z.string().min(1),
  level: z.enum(["LOW", "MEDIUM", "HIGH"]),
  explanation: z.string().min(1),
  policyRef: z.string().min(1),
});

export const ClarificationQuestionSchema = z.object({
  code: z.string().min(1),
  fieldPath: z.string().min(1),
  question: z.string().min(1),
});

export const ReadinessCriterionSchema = z.object({
  id: z.string().min(1),
  score: z.number().int().nonnegative(),
  maximum: z.number().int().positive(),
  explanation: z.string().min(1),
});

const ScoreComponentSchema = z.object({
  score: z.number().int().nonnegative(),
  maximum: z.number().int().positive(),
});

export const ReadinessBreakdownSchema = z.object({
  completeness: ScoreComponentSchema,
  budget: ScoreComponentSchema,
  policyCompliance: ScoreComponentSchema,
  measurableObjective: ScoreComponentSchema,
  total: z.number().int().min(0).max(100),
});

export const ValidationResultSchema = z.object({
  isValid: z.boolean(),
  issues: z.array(ValidationIssueSchema),
  validatedBrief: ValidatedCampaignBriefSchema.optional(),
});

export const CampaignReadinessDecisionSchema = z.object({
  status: CampaignStatusSchema,
  score: z.number().int().min(0).max(100),
  scoreBreakdown: ReadinessBreakdownSchema,
  validationIssues: z.array(ValidationIssueSchema),
  risks: z.array(CampaignRiskSchema),
  clarificationQuestions: z.array(ClarificationQuestionSchema),
  requiresHumanReview: z.boolean(),
  policyRefs: z.array(z.string().min(1)),
  rulesVersion: z.string().min(1),
});

export type Objective = z.infer<typeof ObjectiveSchema>;
export type KpiMetric = z.infer<typeof KpiMetricSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type Currency = z.infer<typeof CurrencySchema>;
export type TargetKpi = z.infer<typeof TargetKpiSchema>;
export type PartialCampaignBrief = z.infer<typeof PartialCampaignBriefSchema>;
export type ValidatedCampaignBrief = z.infer<
  typeof ValidatedCampaignBriefSchema
>;
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type CampaignRisk = z.infer<typeof CampaignRiskSchema>;
export type ClarificationQuestion = z.infer<
  typeof ClarificationQuestionSchema
>;
export type ReadinessCriterion = z.infer<typeof ReadinessCriterionSchema>;
export type ReadinessBreakdown = z.infer<typeof ReadinessBreakdownSchema>;
export type CampaignReadinessDecision = z.infer<
  typeof CampaignReadinessDecisionSchema
>;
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;
