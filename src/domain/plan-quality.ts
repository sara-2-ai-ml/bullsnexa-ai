import {
  ValidatedCampaignBriefSchema,
  type CampaignReadinessDecision,
  type ValidatedCampaignBrief,
} from "./schemas.js";

export const PLAN_QUALITY_VERSION = "1.0.0";

export const PLAN_QUALITY_NOTICE =
  "Advisory only. Synthetic benchmarks. It never changes the readiness status, score or approval.";

export type QualitySeverity = "info" | "warning";

export interface QualitySignal {
  readonly code: string;
  readonly severity: QualitySeverity;
  /** Points deducted from 100. */
  readonly points: number;
  readonly message: string;
}

export interface PlanQuality {
  readonly version: string;
  /** 0–100; 100 means no quality concern was found. */
  readonly score: number;
  readonly label: "Strong" | "Fair" | "Weak";
  readonly signals: readonly QualitySignal[];
  readonly notice: string;
}

/**
 * Synthetic cost-per-result ranges, in campaign currency units. For reach and
 * impressions the range is a cost per 1,000. They are demonstration values,
 * not market data, and are applied identically to USD, EUR and GBP.
 */
const COST_PER_RESULT: Readonly<Record<string, readonly [number, number]>> = {
  leads: [5, 150],
  purchases: [10, 250],
  installs: [0.5, 15],
  clicks: [0.2, 5],
  sessions: [0.1, 4],
  impressions: [1, 40],
  reach: [1, 40],
};
/** A target cost below the lower bound is very ambitious. */
const TARGET_COST: Readonly<Record<string, readonly [number, number]>> = {
  cost_per_lead: [5, 150],
  cost_per_install: [0.5, 15],
};
/** Target return per unit of spend. */
const RETURN_RANGE: readonly [number, number] = [1, 10];

export const QUALITY_THRESHOLDS = {
  minDailyBudgetWarning: 20,
  minDailyBudgetInfo: 50,
  minLeadDaysWarning: 3,
  minLeadDaysInfo: 7,
  minDurationDays: 7,
  maxDurationDays: 92,
  minAudienceChars: 20,
} as const;

function epochDay(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

function kpiSignal(brief: ValidatedCampaignBrief): QualitySignal | undefined {
  const { metric, targetValue } = brief.targetKpi;
  const cur = brief.currency;
  const perResult = COST_PER_RESULT[metric];
  if (perResult) {
    const perThousand = metric === "impressions" || metric === "reach";
    const implied = perThousand
      ? (brief.budgetAmount / targetValue) * 1000
      : brief.budgetAmount / targetValue;
    const unit = perThousand ? `per 1,000 ${metric}` : `per ${metric.replace(/s$/, "")}`;
    const [low, high] = perResult;
    if (implied < low) {
      return {
        code: "KPI_TARGET_AMBITIOUS",
        severity: "warning",
        points: 25,
        message: `The target implies ${round2(implied)} ${cur} ${unit}, below the synthetic range of ${low}–${high}. It may be unrealistic for this budget.`,
      };
    }
    if (implied > high) {
      return {
        code: "KPI_TARGET_LOW",
        severity: "info",
        points: 10,
        message: `The target implies ${round2(implied)} ${cur} ${unit}, above the synthetic range of ${low}–${high}. The budget could support a higher target.`,
      };
    }
    return undefined;
  }
  const targetCost = TARGET_COST[metric];
  if (targetCost && targetValue < targetCost[0]) {
    return {
      code: "KPI_TARGET_AMBITIOUS",
      severity: "warning",
      points: 25,
      message: `A target of ${targetValue} ${cur} ${metric.replace(/_/g, " ")} is below the synthetic range of ${targetCost[0]}–${targetCost[1]}.`,
    };
  }
  if (metric === "return_on_ad_spend" && targetValue > RETURN_RANGE[1]) {
    return {
      code: "KPI_TARGET_AMBITIOUS",
      severity: "warning",
      points: 25,
      message: `A return on ad spend of ${targetValue} is above the synthetic ceiling of ${RETURN_RANGE[1]}.`,
    };
  }
  if (metric === "revenue") {
    const ratio = targetValue / brief.budgetAmount;
    if (ratio > RETURN_RANGE[1]) {
      return {
        code: "KPI_TARGET_AMBITIOUS",
        severity: "warning",
        points: 25,
        message: `The revenue target is ${round2(ratio)}× the budget, above the synthetic ceiling of ${RETURN_RANGE[1]}×.`,
      };
    }
  }
  return undefined;
}

/**
 * Deterministic, advisory plan-quality assessment. It answers a different
 * question from the readiness score: not "may this launch?" but "how sensible
 * does this plan look?". Pure function: brief, decision and an explicit date.
 * Blocked campaigns and briefs that do not fully validate get no assessment.
 */
export function assessPlanQuality(
  briefInput: unknown,
  decision: CampaignReadinessDecision | undefined,
  today: string,
): PlanQuality | undefined {
  if (!decision || decision.status === "BLOCKED") return undefined;
  const parsed = ValidatedCampaignBriefSchema.safeParse(briefInput);
  if (!parsed.success) return undefined;
  const brief = parsed.data;
  const t = QUALITY_THRESHOLDS;

  const signals: QualitySignal[] = [];
  const kpi = kpiSignal(brief);
  if (kpi) signals.push(kpi);

  const durationDays = epochDay(brief.endDate) - epochDay(brief.startDate) + 1;
  const daily = brief.budgetAmount / durationDays;
  if (daily < t.minDailyBudgetWarning) {
    signals.push({
      code: "THIN_DAILY_BUDGET",
      severity: "warning",
      points: 20,
      message: `About ${round2(daily)} ${brief.currency} per day, below ${t.minDailyBudgetWarning}. Delivery and learning may be too slow.`,
    });
  } else if (daily < t.minDailyBudgetInfo) {
    signals.push({
      code: "LOW_DAILY_BUDGET",
      severity: "info",
      points: 10,
      message: `About ${round2(daily)} ${brief.currency} per day, below ${t.minDailyBudgetInfo}.`,
    });
  }

  if (durationDays < t.minDurationDays) {
    signals.push({
      code: "SHORT_FLIGHT",
      severity: "warning",
      points: 10,
      message: `The campaign runs ${durationDays} day(s); under ${t.minDurationDays} days leaves little time to optimize.`,
    });
  } else if (durationDays > t.maxDurationDays) {
    signals.push({
      code: "LONG_FLIGHT",
      severity: "info",
      points: 5,
      message: `The campaign runs ${durationDays} days; consider phases with a review point.`,
    });
  }

  const leadDays = epochDay(brief.startDate) - epochDay(today);
  if (leadDays >= 0 && leadDays < t.minLeadDaysWarning) {
    signals.push({
      code: "VERY_SHORT_LEAD_TIME",
      severity: "warning",
      points: 15,
      message: `It starts in ${leadDays} day(s), leaving almost no time for creative and tracking checks.`,
    });
  } else if (leadDays >= 0 && leadDays < t.minLeadDaysInfo) {
    signals.push({
      code: "SHORT_LEAD_TIME",
      severity: "info",
      points: 8,
      message: `It starts in ${leadDays} days; a week is a safer setup window.`,
    });
  }

  if (new Set(brief.channels).size === 1) {
    signals.push({
      code: "SINGLE_CHANNEL",
      severity: "info",
      points: 5,
      message: "Only one channel is planned, so results depend on a single platform.",
    });
  }

  if (brief.targetAudience.trim().length < t.minAudienceChars) {
    signals.push({
      code: "BROAD_AUDIENCE",
      severity: "info",
      points: 5,
      message: "The audience description is short; a sharper audience is easier to target and measure.",
    });
  }

  const score = Math.max(0, 100 - signals.reduce((sum, signal) => sum + signal.points, 0));
  return {
    version: PLAN_QUALITY_VERSION,
    score,
    label: score >= 85 ? "Strong" : score >= 65 ? "Fair" : "Weak",
    signals,
    notice: PLAN_QUALITY_NOTICE,
  };
}
