import {
  ValidatedCampaignBriefSchema,
  type CampaignReadinessDecision,
  type ValidatedCampaignBrief,
} from "./schemas.js";

export const LAUNCH_PLAN_VERSION = "1.0.0";

export const LAUNCH_PLAN_NOTICE =
  "Synthetic demonstration plan built deterministically from the validated brief and the trusted decision. It is not an instruction to any advertising platform, and nothing is published.";

export interface ChannelAllocation {
  readonly channel: string;
  readonly amount: number;
  readonly sharePercent: number;
}

export interface ChecklistItem {
  readonly code: string;
  readonly fieldPath: string;
  readonly action: string;
  readonly required: boolean;
  readonly policyRef: string | undefined;
}

export interface LaunchPlan {
  readonly planVersion: string;
  readonly campaignName: string;
  readonly readinessStatus: "READY" | "NEEDS_REVIEW";
  readonly schedule: {
    readonly startDate: string;
    readonly endDate: string;
    readonly durationDays: number;
  };
  readonly budget: {
    readonly total: number;
    readonly currency: string;
    readonly dailyBudget: number;
    readonly allocationBasis: "EQUAL_SPLIT_PLACEHOLDER";
    readonly channels: readonly ChannelAllocation[];
  };
  readonly kpi: { readonly metric: string; readonly targetValue: number };
  readonly checklist: readonly ChecklistItem[];
  readonly risks: readonly {
    readonly code: string;
    readonly level: string;
    readonly policyRef: string;
  }[];
  readonly approval: {
    readonly humanReviewRequired: boolean;
    readonly reasons: readonly string[];
  };
  readonly policyRefs: readonly string[];
  readonly rulesVersion: string;
  readonly assumptions: readonly string[];
  readonly summary: string;
  readonly notice: string;
}

export type LaunchPlanResult =
  | { readonly ok: true; readonly plan: LaunchPlan }
  | {
      readonly ok: false;
      readonly reason:
        | "BLOCKED_CAMPAIGN_HAS_NO_PLAN"
        | "BRIEF_NOT_FULLY_VALID";
    };

function epochDay(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function money(cents: number): number {
  return Math.round(cents) / 100;
}

function allocate(
  brief: ValidatedCampaignBrief,
): readonly ChannelAllocation[] {
  const totalCents = Math.round(brief.budgetAmount * 100);
  const channels = [...new Set(brief.channels)];
  const base = Math.floor(totalCents / channels.length);
  const remainder = totalCents - base * channels.length;
  return channels.map((channel, index) => {
    const cents = base + (index < remainder ? 1 : 0);
    return {
      channel,
      amount: money(cents),
      sharePercent: Math.round((cents / totalCents) * 10_000) / 100,
    };
  });
}

/**
 * Deterministic launch plan. It takes only the validated brief and the trusted
 * decision: no model output, clock or randomness. A BLOCKED campaign has no
 * plan, and a brief that does not fully validate (for example an unsupported
 * channel) cannot produce one until it is corrected.
 */
export function createLaunchPlan(
  brief: unknown,
  decision: CampaignReadinessDecision,
): LaunchPlanResult {
  if (decision.status === "BLOCKED") {
    return { ok: false, reason: "BLOCKED_CAMPAIGN_HAS_NO_PLAN" };
  }
  const parsed = ValidatedCampaignBriefSchema.safeParse(brief);
  if (!parsed.success) return { ok: false, reason: "BRIEF_NOT_FULLY_VALID" };

  const valid = parsed.data;
  const durationDays = epochDay(valid.endDate) - epochDay(valid.startDate) + 1;
  if (durationDays < 1) return { ok: false, reason: "BRIEF_NOT_FULLY_VALID" };

  const channels = allocate(valid);
  const totalCents = Math.round(valid.budgetAmount * 100);
  const checklist = decision.validationIssues
    .filter((issue) => issue.severity === "REVIEW_REQUIRED" || issue.severity === "WARNING")
    .map(
      (issue): ChecklistItem => ({
        code: issue.code,
        fieldPath: issue.fieldPath,
        action: issue.suggestedAction,
        required: issue.severity === "REVIEW_REQUIRED",
        policyRef: issue.policyRef,
      }),
    );
  const humanReviewRequired =
    decision.status === "NEEDS_REVIEW" || decision.requiresHumanReview;
  const reasons = [
    ...new Set([
      ...checklist.filter((item) => item.required).map((item) => item.code),
      ...decision.risks.map((risk) => risk.code),
    ]),
  ];
  const dailyBudget = money(totalCents / durationDays);

  const summary = [
    `Launch plan for "${valid.campaignName}": ${valid.startDate} to ${valid.endDate} (${durationDays} days),`,
    `${valid.budgetAmount} ${valid.currency} (about ${dailyBudget} ${valid.currency} per day) across ${channels.map((entry) => entry.channel).join(", ")},`,
    `target ${valid.targetKpi.targetValue} ${valid.targetKpi.metric}.`,
    humanReviewRequired
      ? `Human approval is required before handoff (${reasons.join(", ") || "review flagged"}).`
      : "No human approval is required before handoff.",
    checklist.length > 0
      ? `${checklist.length} open checklist item(s).`
      : "No open checklist items.",
  ].join(" ");

  return {
    ok: true,
    plan: {
      planVersion: LAUNCH_PLAN_VERSION,
      campaignName: valid.campaignName,
      readinessStatus: decision.status,
      schedule: {
        startDate: valid.startDate,
        endDate: valid.endDate,
        durationDays,
      },
      budget: {
        total: valid.budgetAmount,
        currency: valid.currency,
        dailyBudget,
        allocationBasis: "EQUAL_SPLIT_PLACEHOLDER",
        channels,
      },
      kpi: {
        metric: valid.targetKpi.metric,
        targetValue: valid.targetKpi.targetValue,
      },
      checklist,
      risks: decision.risks.map((risk) => ({
        code: risk.code,
        level: risk.level,
        policyRef: risk.policyRef,
      })),
      approval: { humanReviewRequired, reasons },
      policyRefs: decision.policyRefs,
      rulesVersion: decision.rulesVersion,
      assumptions: [
        "The per-channel budget is an equal split placeholder, not an optimized allocation.",
        "Dates, budget, channels and KPI are taken unchanged from the validated brief.",
      ],
      summary,
      notice: LAUNCH_PLAN_NOTICE,
    },
  };
}
