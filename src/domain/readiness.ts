import { z, type ZodType } from "zod";

import type { SyntheticRulesConfig } from "./rules-config.js";
import {
  CampaignReadinessDecisionSchema,
  ChannelSchema,
  CurrencySchema,
  IsoDateSchema,
  ObjectiveSchema,
  TargetCountrySchema,
  TargetKpiSchema,
  ValidatedCampaignBriefSchema,
  type CampaignReadinessDecision,
  type CampaignRisk,
  type CampaignStatus,
  type ClarificationQuestion,
  type ValidationIssue,
  type ValidationResult,
} from "./schemas.js";

interface Inspection {
  readonly normalized: Record<string, unknown>;
  readonly validFields: ReadonlySet<string>;
  readonly criticalProblemFields: ReadonlySet<string>;
  readonly unsupportedChannelCount: number;
  readonly issues: readonly ValidationIssue[];
  readonly risks: readonly CampaignRisk[];
  readonly questions: readonly ClarificationQuestion[];
  readonly validationResult: ValidationResult;
}

interface StatusInputs {
  readonly score: number;
  readonly readinessThreshold: number;
  readonly hasBlocker: boolean;
  readonly hasCriticalProblem: boolean;
  readonly requiresHumanReview: boolean;
}

const textSchema = z.string().trim().min(1);

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function inspectBrief(
  brief: unknown,
  config: SyntheticRulesConfig,
  today: string,
): Inspection {
  const raw = asRecord(brief);
  const normalized: Record<string, unknown> = {};
  const validFields = new Set<string>();
  const criticalProblemFields = new Set<string>();
  const issues: ValidationIssue[] = [];
  const risks: CampaignRisk[] = [];
  const questions: ClarificationQuestion[] = [];
  const requirementsPolicy = config.policies.campaignRequirements.id;

  const isCritical = (field: string): boolean =>
    config.score.completeness.criticalFields.includes(field);

  const addQuestion = (field: string, message: string): void => {
    if (questions.some((question) => question.fieldPath === field)) return;
    questions.push({
      code: `CLARIFY_${field.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
      fieldPath: field,
      question: message,
    });
  };

  const addMissing = (field: string, question: string): void => {
    issues.push({
      code: "MISSING_REQUIRED_FIELD",
      fieldPath: field,
      severity: "WARNING",
      explanation: `${field} is required for a complete campaign brief.`,
      suggestedAction: question,
      policyRef: requirementsPolicy,
    });
    if (isCritical(field)) {
      criticalProblemFields.add(field);
      addQuestion(field, question);
    }
  };

  const addInvalid = (
    field: string,
    code: string,
    explanation: string,
    suggestedAction: string,
    severity: ValidationIssue["severity"] = "WARNING",
    policyRef = requirementsPolicy,
  ): void => {
    issues.push({
      code,
      fieldPath: field,
      severity,
      explanation,
      suggestedAction,
      policyRef,
    });
    if (isCritical(field)) {
      criticalProblemFields.add(field);
      addQuestion(field, suggestedAction);
    }
  };

  const parseField = <T>(
    field: string,
    schema: ZodType<T>,
    question: string,
    invalidCode: string,
    invalidExplanation: string,
  ): T | undefined => {
    if (!(field in raw) || raw[field] === undefined) {
      addMissing(field, question);
      return undefined;
    }
    const result = schema.safeParse(raw[field]);
    if (!result.success) {
      addInvalid(field, invalidCode, invalidExplanation, question);
      return undefined;
    }
    normalized[field] = result.data;
    validFields.add(field);
    return result.data;
  };

  if (brief === null || typeof brief !== "object" || Array.isArray(brief)) {
    issues.push({
      code: "INVALID_BRIEF_TYPE",
      fieldPath: "$",
      severity: "WARNING",
      explanation: "The campaign brief must be an object.",
      suggestedAction: "Provide a structured campaign brief object.",
      policyRef: requirementsPolicy,
    });
  }

  parseField(
    "campaignName",
    textSchema,
    "What is the campaign name?",
    "INVALID_CAMPAIGN_NAME",
    "campaignName must be a non-empty string.",
  );

  const objective = parseField(
    "objective",
    ObjectiveSchema,
    "Which supported objective applies: leads, sales, awareness, traffic, or app_installs?",
    "UNSUPPORTED_OBJECTIVE",
    "objective must be one of the explicitly supported objective values.",
  );

  parseField(
    "targetAudience",
    textSchema,
    "Who is the target audience?",
    "INVALID_TARGET_AUDIENCE",
    "targetAudience must be a non-empty string.",
  );

  const targetCountry = parseField(
    "targetCountry",
    TargetCountrySchema,
    "What is the target country as an ISO alpha-2 code, such as DE or US?",
    "INVALID_TARGET_COUNTRY",
    "targetCountry must use a two-letter ISO alpha-2 representation.",
  );

  let unsupportedChannelCount = 0;
  if (!("channels" in raw) || raw.channels === undefined) {
    addMissing("channels", "Which supported channels should the campaign use?");
  } else if (!Array.isArray(raw.channels) || raw.channels.length === 0) {
    addInvalid(
      "channels",
      "INVALID_CHANNELS",
      "channels must be a non-empty array.",
      "Provide one or more supported channels.",
    );
  } else {
    const invalidTypeCount = raw.channels.filter(
      (channel) => typeof channel !== "string",
    ).length;
    const channelNames = raw.channels.filter(
      (channel): channel is string => typeof channel === "string",
    );
    unsupportedChannelCount = channelNames.filter(
      (channel) => !config.supportedChannels.includes(channel),
    ).length;
    const parsedChannels = z.array(ChannelSchema).min(1).safeParse(raw.channels);
    if (invalidTypeCount > 0) {
      addInvalid(
        "channels",
        "INVALID_CHANNEL_TYPE",
        "Every channel must be a string.",
        "Provide only supported channel names.",
      );
    } else if (unsupportedChannelCount > 0 || !parsedChannels.success) {
      addInvalid(
        "channels",
        "UNSUPPORTED_CHANNEL",
        "One or more channels are outside the synthetic supported-channel list.",
        "Select only search, social, display, email, or video.",
        "REVIEW_REQUIRED",
        config.policies.channels.id,
      );
      risks.push({
        code: "UNSUPPORTED_CHANNEL",
        level: "MEDIUM",
        explanation: "The campaign includes a channel without a Phase 1 policy definition.",
        policyRef: config.policies.channels.id,
      });
    } else {
      normalized.channels = parsedChannels.data;
      validFields.add("channels");
    }
  }

  if (!("budgetAmount" in raw) || raw.budgetAmount === undefined) {
    addMissing("budgetAmount", "What is the campaign budget amount?");
  } else if (
    typeof raw.budgetAmount !== "number" ||
    !Number.isFinite(raw.budgetAmount) ||
    raw.budgetAmount <= 0
  ) {
    addInvalid(
      "budgetAmount",
      "INVALID_BUDGET",
      "A supplied budget must be a positive, finite number.",
      "Provide a positive, finite numeric budget.",
      "BLOCKER",
      config.policies.budget.id,
    );
    risks.push({
      code: "INVALID_BUDGET",
      level: "HIGH",
      explanation: "The supplied budget cannot be used for campaign planning.",
      policyRef: config.policies.budget.id,
    });
  } else {
    const budgetAmount = raw.budgetAmount;
    normalized.budgetAmount = budgetAmount;
    validFields.add("budgetAmount");
    if (budgetAmount > config.budgetReviewThreshold) {
      issues.push({
        code: "HIGH_BUDGET_REVIEW_REQUIRED",
        fieldPath: "budgetAmount",
        severity: "REVIEW_REQUIRED",
        explanation: "The valid budget exceeds the synthetic human-review threshold.",
        suggestedAction: "Obtain human budget approval before campaign handoff.",
        policyRef: config.policies.budget.id,
      });
      risks.push({
        code: "HIGH_BUDGET_REVIEW",
        level: "MEDIUM",
        explanation: "Higher spend requires a human approval checkpoint.",
        policyRef: config.policies.budget.id,
      });
    }
  }

  if (!("currency" in raw) || raw.currency === undefined) {
    addMissing("currency", "Which supported currency applies: USD, EUR, or GBP?");
  } else if (
    typeof raw.currency !== "string" ||
    !config.supportedCurrencies.includes(raw.currency)
  ) {
    addInvalid(
      "currency",
      "UNSUPPORTED_CURRENCY",
      "currency is outside the synthetic supported-currency list.",
      "Use USD, EUR, or GBP, or request human review.",
      "REVIEW_REQUIRED",
      config.policies.budget.id,
    );
  } else {
    const parsedCurrency = CurrencySchema.parse(raw.currency);
    normalized.currency = parsedCurrency;
    validFields.add("currency");
  }

  const startDate = parseField(
    "startDate",
    IsoDateSchema,
    "What is the start date in YYYY-MM-DD format?",
    "INVALID_START_DATE",
    "startDate must be a valid calendar date in YYYY-MM-DD format.",
  );
  const endDate = parseField(
    "endDate",
    IsoDateSchema,
    "What is the end date in YYYY-MM-DD format?",
    "INVALID_END_DATE",
    "endDate must be a valid calendar date in YYYY-MM-DD format.",
  );

  const todayResult = IsoDateSchema.safeParse(today);
  if (!todayResult.success) {
    issues.push({
      code: "INVALID_EVALUATION_DATE",
      fieldPath: "today",
      severity: "BLOCKER",
      explanation: "The evaluator today value must be a valid YYYY-MM-DD date.",
      suggestedAction: "Pass an explicit valid calendar date to the evaluator.",
      policyRef: requirementsPolicy,
    });
  }

  if (startDate && endDate && endDate <= startDate) {
    issues.push({
      code: "INVALID_DATE_ORDER",
      fieldPath: "endDate",
      severity: "BLOCKER",
      explanation: "endDate must occur after startDate.",
      suggestedAction: "Choose an end date after the start date.",
      policyRef: requirementsPolicy,
    });
    risks.push({
      code: "INVALID_DATE_ORDER",
      level: "HIGH",
      explanation: "The campaign schedule is chronologically impossible.",
      policyRef: requirementsPolicy,
    });
  } else if (startDate && todayResult.success && startDate < todayResult.data) {
    issues.push({
      code: "START_DATE_IN_PAST",
      fieldPath: "startDate",
      severity: "REVIEW_REQUIRED",
      explanation: "The campaign start date is before the explicit evaluation date.",
      suggestedAction: "Confirm whether the campaign should be rescheduled.",
      policyRef: requirementsPolicy,
    });
    risks.push({
      code: "PAST_START_DATE",
      level: "MEDIUM",
      explanation: "A past start date requires schedule review.",
      policyRef: requirementsPolicy,
    });
  }

  const targetKpi = parseField(
    "targetKpi",
    TargetKpiSchema,
    "What KPI metric and positive numeric target should measure success?",
    "INVALID_TARGET_KPI",
    "targetKpi must contain an enumerated metric and positive finite targetValue.",
  );

  if (objective && targetKpi) {
    const compatibleMetrics = config.kpiMetricsByObjective[objective];
    if (!compatibleMetrics.includes(targetKpi.metric)) {
      issues.push({
        code: "OBJECTIVE_KPI_MISMATCH",
        fieldPath: "targetKpi.metric",
        severity: "REVIEW_REQUIRED",
        explanation: "The KPI metric is not compatible with the selected objective.",
        suggestedAction: "Choose a KPI mapped to the objective or clarify the objective.",
        policyRef: requirementsPolicy,
      });
    }
  }

  if (!("category" in raw) || raw.category === undefined) {
    issues.push({
      code: "MISSING_REQUIRED_FIELD",
      fieldPath: "category",
      severity: "WARNING",
      explanation: "category is required to evaluate prohibited-category rules.",
      suggestedAction: "Provide a campaign category.",
      policyRef: config.policies.prohibitedCategories.id,
    });
    criticalProblemFields.add("category");
    addQuestion("category", "What campaign category should be evaluated?");
  } else if (!textSchema.safeParse(raw.category).success) {
    addInvalid(
      "category",
      "INVALID_CATEGORY",
      "category must be a non-empty string.",
      "Provide a campaign category.",
      "WARNING",
      config.policies.prohibitedCategories.id,
    );
    criticalProblemFields.add("category");
    addQuestion("category", "What valid campaign category should be evaluated?");
  } else {
    const category = String(raw.category).trim().toLowerCase();
    normalized.category = category;
    if (config.prohibitedCategories.includes(category)) {
      issues.push({
        code: "PROHIBITED_CATEGORY",
        fieldPath: "category",
        severity: "BLOCKER",
        explanation: "The category is prohibited by the synthetic demonstration rules.",
        suggestedAction: "Do not proceed with this campaign category.",
        policyRef: config.policies.prohibitedCategories.id,
      });
      risks.push({
        code: "PROHIBITED_CATEGORY",
        level: "HIGH",
        explanation: "The campaign category is explicitly prohibited.",
        policyRef: config.policies.prohibitedCategories.id,
      });
    }
  }

  if ("additionalNotes" in raw && raw.additionalNotes !== undefined) {
    if (typeof raw.additionalNotes === "string") {
      normalized.additionalNotes = raw.additionalNotes;
    } else {
      addInvalid(
        "additionalNotes",
        "INVALID_ADDITIONAL_NOTES",
        "additionalNotes must be a string when supplied.",
        "Provide additional notes as text or omit the field.",
      );
    }
  }

  if (
    objective === "leads" &&
    targetCountry &&
    config.euCountries.codes.includes(targetCountry)
  ) {
    issues.push({
      code: "EU_LEADS_PRIVACY_REVIEW_REQUIRED",
      fieldPath: "targetCountry",
      severity: "REVIEW_REQUIRED",
      explanation:
        "The synthetic rules require privacy review for lead-generation campaigns targeting an EU country.",
      suggestedAction: "Complete the synthetic privacy review before campaign handoff.",
      policyRef: config.policies.privacy.id,
    });
    risks.push({
      code: "EU_LEADS_PRIVACY_REVIEW",
      level: "MEDIUM",
      explanation: "EU lead generation requires a human privacy review checkpoint.",
      policyRef: config.policies.privacy.id,
    });
  }

  const validatedResult = ValidatedCampaignBriefSchema.safeParse(normalized);
  const hasBlocker = issues.some((issue) => issue.severity === "BLOCKER");
  const validationResult: ValidationResult = validatedResult.success
    ? {
        isValid: !hasBlocker,
        issues: [...issues],
        validatedBrief: validatedResult.data,
      }
    : { isValid: false, issues: [...issues] };

  return {
    normalized,
    validFields,
    criticalProblemFields,
    unsupportedChannelCount,
    issues,
    risks,
    questions,
    validationResult,
  };
}

export function determineStatus(inputs: StatusInputs): CampaignStatus {
  if (inputs.hasBlocker) return "BLOCKED";
  if (inputs.hasCriticalProblem) return "NEEDS_REVIEW";
  if (inputs.requiresHumanReview) return "NEEDS_REVIEW";
  if (inputs.score < inputs.readinessThreshold) return "NEEDS_REVIEW";
  return "READY";
}

export function validateCampaignBrief(
  brief: unknown,
  config: SyntheticRulesConfig,
  today: string,
): ValidationResult {
  return inspectBrief(brief, config, today).validationResult;
}

export function evaluateReadiness(
  brief: unknown,
  config: SyntheticRulesConfig,
  today: string,
): CampaignReadinessDecision {
  const inspection = inspectBrief(brief, config, today);
  const weights = config.score.completeness.fieldWeights;
  const completenessScore = clamp(
    Object.entries(weights).reduce(
      (score, [field, weight]) =>
        score + (inspection.validFields.has(field) ? weight : 0),
      0,
    ),
    0,
    config.score.completeness.maximum,
  );

  const budgetScore = clamp(
    (inspection.validFields.has("budgetAmount")
      ? config.score.budget.validAmount
      : 0) +
      (inspection.validFields.has("currency")
        ? config.score.budget.supportedCurrency
        : 0),
    0,
    config.score.budget.maximum,
  );

  const categoryScore =
    typeof inspection.normalized.category === "string"
      ? clamp(
          config.score.policyCompliance.categoryMaximum -
            (config.prohibitedCategories.includes(inspection.normalized.category)
              ? config.score.policyCompliance.deductions.prohibitedCategory
              : 0),
          0,
          config.score.policyCompliance.categoryMaximum,
        )
      : 0;
  const rawChannels = asRecord(brief).channels;
  const channelsScore =
    Array.isArray(rawChannels) &&
    rawChannels.length > 0 &&
    rawChannels.every((channel) => typeof channel === "string")
      ? clamp(
        config.score.policyCompliance.channelsMaximum -
          inspection.unsupportedChannelCount *
            config.score.policyCompliance.deductions.unsupportedChannel,
        0,
        config.score.policyCompliance.channelsMaximum,
      )
      : 0;
  const startDate = inspection.normalized.startDate;
  const endDate = inspection.normalized.endDate;
  let datesScore = 0;
  if (typeof startDate === "string" && typeof endDate === "string") {
    if (endDate > startDate) {
      datesScore = config.score.policyCompliance.datesMaximum;
      if (IsoDateSchema.safeParse(today).success && startDate < today) {
        datesScore -= config.score.policyCompliance.deductions.pastStartDate;
      }
    } else {
      datesScore = clamp(
        config.score.policyCompliance.datesMaximum -
          config.score.policyCompliance.deductions.invalidDateOrder,
        0,
        config.score.policyCompliance.datesMaximum,
      );
    }
  }
  const objective = inspection.normalized.objective;
  const country = inspection.normalized.targetCountry;
  let privacyScore = 0;
  if (typeof objective === "string" && typeof country === "string") {
    privacyScore = config.score.policyCompliance.privacyMaximum;
    if (objective === "leads" && config.euCountries.codes.includes(country)) {
      privacyScore -= config.score.policyCompliance.deductions.privacyReview;
    }
  }
  const policyScore = clamp(
    categoryScore + channelsScore + datesScore + privacyScore,
    0,
    config.score.policyCompliance.maximum,
  );

  const targetKpi = inspection.normalized.targetKpi;
  const objectiveScore = inspection.validFields.has("objective")
    ? config.score.measurableObjective.supportedObjective
    : 0;
  const kpiScore = inspection.validFields.has("targetKpi")
    ? config.score.measurableObjective.validKpi
    : 0;
  const compatible =
    typeof objective === "string" &&
    typeof targetKpi === "object" &&
    targetKpi !== null &&
    "metric" in targetKpi &&
    config.kpiMetricsByObjective[
      objective as keyof typeof config.kpiMetricsByObjective
    ].includes((targetKpi as { metric: never }).metric);
  const measurableObjectiveScore = clamp(
    objectiveScore +
      kpiScore +
      (compatible ? config.score.measurableObjective.compatibleKpi : 0),
    0,
    config.score.measurableObjective.maximum,
  );

  const total = clamp(
    completenessScore + budgetScore + policyScore + measurableObjectiveScore,
    0,
    100,
  );
  const hasBlocker = inspection.issues.some(
    (issue) => issue.severity === "BLOCKER",
  );
  const requiresHumanReview = inspection.issues.some(
    (issue) => issue.severity === "REVIEW_REQUIRED",
  );
  const status = determineStatus({
    score: total,
    readinessThreshold: config.readinessThreshold,
    hasBlocker,
    hasCriticalProblem: inspection.criticalProblemFields.size > 0,
    requiresHumanReview,
  });

  const decision: CampaignReadinessDecision = {
    status,
    score: total,
    scoreBreakdown: {
      completeness: {
        score: completenessScore,
        maximum: config.score.completeness.maximum,
      },
      budget: { score: budgetScore, maximum: config.score.budget.maximum },
      policyCompliance: {
        score: policyScore,
        maximum: config.score.policyCompliance.maximum,
      },
      measurableObjective: {
        score: measurableObjectiveScore,
        maximum: config.score.measurableObjective.maximum,
      },
      total,
    },
    validationIssues: [...inspection.issues],
    risks: [...inspection.risks],
    clarificationQuestions: [...inspection.questions],
    requiresHumanReview,
    policyRefs: Object.values(config.policies).map((policy) => policy.id),
    rulesVersion: config.version,
  };

  return CampaignReadinessDecisionSchema.parse(decision);
}
