"use strict";

export function decisionPresentation(data) {
  const status = data.businessStatus;
  const quality = data.planQuality;
  if (status === "READY" && quality?.label === "Strong") return { tone: "ready", icon: "check", title: "Required checks passed", note: "The campaign passed the deterministic launch-readiness rules.", conclusion: "The brief is complete and the advisory review found no major planning concerns.", next: "Review the launch plan, then continue with your normal publishing workflow." };
  if (status === "READY") return { tone: "review", icon: "alert", title: "Required checks passed; review the plan", note: "The campaign passed the deterministic launch-readiness rules.", conclusion: "The campaign may proceed under the current rules, but the advisory launch plan needs attention.", next: "Review the recommendations and adjust the brief where they improve the plan." };
  if (status === "NEEDS_REVIEW") return { tone: "review", icon: "user", title: "Human review required", note: data.summary || "The campaign is valid but requires a person to review specific risks.", conclusion: "The campaign cannot be cleared until the required review is recorded.", next: "Address the highlighted recommendations, then approve or reject this exact plan." };
  if (status === "BLOCKED") return { tone: "blocked", icon: "x", title: "Critical issues must be fixed", note: data.summary || "One or more launch requirements are not satisfied.", conclusion: "The campaign cannot proceed under the current rules.", next: "Correct the blocking fields in Step 2 and run the assessment again." };
  if (data.executionStatus === "WAITING_FOR_CLARIFICATION") return { tone: "info", icon: "help", title: "More campaign details are needed", note: data.summary || "Complete the requested campaign details before continuing.", conclusion: "No decision has been made yet.", next: "Answer the questions below in Step 2 and run the agent again." };
  if (data.executionStatus === "REFUSED") return { tone: "blocked", icon: "shield", title: "Request safely refused", note: data.summary || "The request could not be processed safely.", conclusion: "No campaign decision was produced.", next: "Review the campaign request and remove unsupported or unsafe instructions." };
  return { tone: "blocked", icon: "alert", title: "Assessment could not be completed", note: data.summary || "The agent stopped before reaching a campaign decision.", conclusion: "No campaign decision was produced.", next: "Review the error details or try the assessment again." };
}

export function targetCostInsight(plan) {
  const metric = plan?.kpi?.metric;
  const value = Number(plan?.kpi?.targetValue);
  const budget = Number(plan?.budget?.total);
  if (!metric || !(value > 0) || !Number.isFinite(budget)) return null;
  const direct = new Set(["leads", "purchases", "installs", "clicks", "sessions"]);
  if (direct.has(metric)) return { amount: budget / value, unit: "per " + metric.replace(/s$/, ""), formula: `${budget} / ${value}` };
  if (metric === "impressions" || metric === "reach") return { amount: budget / value * 1000, unit: "per 1,000 " + metric, formula: `${budget} / ${value} × 1,000` };
  return null;
}

export function recommendationFields(code) {
  const map = {
    KPI_TARGET_AMBITIOUS: [["f-budgetAmount", "Review budget"], ["f-kpiValue", "Review KPI target"]],
    KPI_TARGET_LOW: [["f-kpiValue", "Review KPI target"]],
    THIN_DAILY_BUDGET: [["f-budgetAmount", "Review budget"], ["f-startDate", "Review dates"]],
    LOW_DAILY_BUDGET: [["f-budgetAmount", "Review budget"], ["f-startDate", "Review dates"]],
    SHORT_FLIGHT: [["f-endDate", "Review end date"]],
    LONG_FLIGHT: [["f-endDate", "Review end date"]],
    VERY_SHORT_LEAD_TIME: [["f-startDate", "Review start date"]],
    SHORT_LEAD_TIME: [["f-startDate", "Review start date"]],
    SINGLE_CHANNEL: [["f-channels", "Review channels"]],
    BROAD_AUDIENCE: [["f-targetAudience", "Review audience"]],
  };
  return map[code] || [];
}
