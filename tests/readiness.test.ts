import { describe, expect, it } from "vitest";

import {
  determineStatus,
  evaluateReadiness,
  validateCampaignBrief,
} from "../src/domain/readiness.js";
import { syntheticRulesConfig } from "../src/domain/rules-config.js";

const TODAY = "2026-01-15";
const validBrief = {
  campaignName: "Spring Launch",
  objective: "sales",
  targetAudience: "Sustainable retail customers",
  targetCountry: "US",
  channels: ["search", "social"],
  budgetAmount: 50_000,
  currency: "USD",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  targetKpi: { metric: "purchases", targetValue: 1_000 },
  category: "retail",
} as const;

describe("deterministic campaign validation", () => {
  it("distinguishes a missing budget from an invalid budget", () => {
    const missing = evaluateReadiness(
      { ...validBrief, budgetAmount: undefined },
      syntheticRulesConfig,
      TODAY,
    );
    expect(missing.status).toBe("NEEDS_REVIEW");
    expect(missing.validationIssues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_REQUIRED_FIELD",
        fieldPath: "budgetAmount",
      }),
    );
    expect(missing.clarificationQuestions).toContainEqual(
      expect.objectContaining({ fieldPath: "budgetAmount" }),
    );
  });

  it.each([0, -1, NaN, Infinity])(
    "blocks the supplied invalid budget %s",
    (budgetAmount) => {
      const result = evaluateReadiness(
        { ...validBrief, budgetAmount },
        syntheticRulesConfig,
        TODAY,
      );
      expect(result.status).toBe("BLOCKED");
      expect(result.validationIssues).toContainEqual(
        expect.objectContaining({
          code: "INVALID_BUDGET",
          severity: "BLOCKER",
        }),
      );
    },
  );

  it("requires review for an unsupported currency", () => {
    const result = evaluateReadiness(
      { ...validBrief, currency: "CHF" },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.requiresHumanReview).toBe(true);
    expect(result.scoreBreakdown.budget.score).toBe(15);
  });

  it("requires review for an unsupported channel", () => {
    const result = evaluateReadiness(
      { ...validBrief, channels: ["sms"] },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.risks.map((risk) => risk.code)).toContain(
      "UNSUPPORTED_CHANNEL",
    );
  });

  it("requires review when the start date is in the past", () => {
    const result = evaluateReadiness(
      { ...validBrief, startDate: "2025-12-31" },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.validationIssues).toContainEqual(
      expect.objectContaining({ code: "START_DATE_IN_PAST" }),
    );
  });

  it("blocks an end date before the start date", () => {
    const result = evaluateReadiness(
      { ...validBrief, startDate: "2026-06-30", endDate: "2026-06-01" },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.status).toBe("BLOCKED");
    expect(result.validationIssues).toContainEqual(
      expect.objectContaining({ code: "INVALID_DATE_ORDER" }),
    );
  });

  it("blocks equal start and end dates", () => {
    const result = evaluateReadiness(
      { ...validBrief, startDate: "2026-06-01", endDate: "2026-06-01" },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.status).toBe("BLOCKED");
    expect(result.scoreBreakdown.policyCompliance.score).toBe(20);
  });

  it("awards no channel policy evidence for an empty channel list", () => {
    const result = evaluateReadiness(
      { ...validBrief, channels: [] },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.scoreBreakdown.policyCompliance.score).toBe(18);
    expect(result.clarificationQuestions).toContainEqual(
      expect.objectContaining({ fieldPath: "channels" }),
    );
  });

  it("asks for a missing target country", () => {
    const result = evaluateReadiness(
      { ...validBrief, targetCountry: undefined },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.clarificationQuestions).toContainEqual(
      expect.objectContaining({ fieldPath: "targetCountry" }),
    );
  });

  it("does not mark a brief ready when its KPI is missing", () => {
    const result = evaluateReadiness(
      { ...validBrief, targetKpi: undefined },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.clarificationQuestions).toContainEqual(
      expect.objectContaining({ fieldPath: "targetKpi" }),
    );
  });

  it("does not claim policy readiness when category is missing", () => {
    const result = evaluateReadiness(
      { ...validBrief, category: undefined },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.clarificationQuestions).toContainEqual(
      expect.objectContaining({ fieldPath: "category" }),
    );
  });

  it("does not guess an unsupported objective", () => {
    const result = evaluateReadiness(
      { ...validBrief, objective: "engagement" },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.validationIssues).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_OBJECTIVE" }),
    );
    expect(result.clarificationQuestions).toContainEqual(
      expect.objectContaining({ fieldPath: "objective" }),
    );
  });

  it("blocks an explicitly prohibited category", () => {
    const result = evaluateReadiness(
      { ...validBrief, category: "tobacco" },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.status).toBe("BLOCKED");
    expect(result.validationIssues).toContainEqual(
      expect.objectContaining({ code: "PROHIBITED_CATEGORY" }),
    );
  });

  it("returns a structurally validated brief for complete valid input", () => {
    const validation = validateCampaignBrief(
      validBrief,
      syntheticRulesConfig,
      TODAY,
    );
    expect(validation.isValid).toBe(true);
    expect(validation.validatedBrief).toBeDefined();
  });
});

describe("objective and KPI compatibility", () => {
  it.each([
    ["leads", "cost_per_lead"],
    ["sales", "revenue"],
    ["awareness", "reach"],
    ["traffic", "sessions"],
    ["app_installs", "installs"],
  ] as const)("accepts %s with %s", (objective, metric) => {
    const result = evaluateReadiness(
      { ...validBrief, objective, targetKpi: { metric, targetValue: 100 } },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.validationIssues).not.toContainEqual(
      expect.objectContaining({ code: "OBJECTIVE_KPI_MISMATCH" }),
    );
    expect(result.scoreBreakdown.measurableObjective.score).toBe(15);
  });

  it("flags an incompatible objective and KPI without guessing", () => {
    const result = evaluateReadiness(
      {
        ...validBrief,
        objective: "awareness",
        targetKpi: { metric: "purchases", targetValue: 100 },
      },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.requiresHumanReview).toBe(true);
    expect(result.scoreBreakdown.measurableObjective.score).toBe(10);
    expect(result.validationIssues).toContainEqual(
      expect.objectContaining({ code: "OBJECTIVE_KPI_MISMATCH" }),
    );
  });
});

describe("privacy review and scoring", () => {
  it("requires explicit privacy review for German lead generation", () => {
    const result = evaluateReadiness(
      {
        ...validBrief,
        objective: "leads",
        targetCountry: "de",
        currency: "EUR",
        targetKpi: { metric: "leads", targetValue: 750 },
      },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.score).toBe(97);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.validationIssues).toContainEqual(
      expect.objectContaining({
        code: "EU_LEADS_PRIVACY_REVIEW_REQUIRED",
        severity: "REVIEW_REQUIRED",
        policyRef: "PRIVACY_REVIEW_POLICY_V1",
      }),
    );
  });

  it("awards the maximum score to a complete compliant brief", () => {
    const result = evaluateReadiness(validBrief, syntheticRulesConfig, TODAY);
    expect(result.score).toBe(100);
    expect(result.status).toBe("READY");
    expect(result.scoreBreakdown).toEqual({
      completeness: { score: 40, maximum: 40 },
      budget: { score: 20, maximum: 20 },
      policyCompliance: { score: 25, maximum: 25 },
      measurableObjective: { score: 15, maximum: 15 },
      total: 100,
    });
  });

  it("keeps every component and total within configured caps", () => {
    const result = evaluateReadiness(validBrief, syntheticRulesConfig, TODAY);
    for (const component of [
      result.scoreBreakdown.completeness,
      result.scoreBreakdown.budget,
      result.scoreBreakdown.policyCompliance,
      result.scoreBreakdown.measurableObjective,
    ]) {
      expect(component.score).toBeGreaterThanOrEqual(0);
      expect(component.score).toBeLessThanOrEqual(component.maximum);
    }
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("requires human review above the budget threshold without deducting points", () => {
    const result = evaluateReadiness(
      { ...validBrief, budgetAmount: 150_000 },
      syntheticRulesConfig,
      TODAY,
    );
    expect(result.score).toBe(100);
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("is deeply deterministic for identical explicit inputs", () => {
    const first = evaluateReadiness(validBrief, syntheticRulesConfig, TODAY);
    const second = evaluateReadiness(validBrief, syntheticRulesConfig, TODAY);
    expect(first).toEqual(second);
  });
});

describe("status boundaries and precedence", () => {
  it.each([59, 60, 79, 80, 84])(
    "returns NEEDS_REVIEW for score %i without other gates",
    (score) => {
      expect(
        determineStatus({
          score,
          readinessThreshold: 85,
          hasBlocker: false,
          hasCriticalProblem: false,
          requiresHumanReview: false,
        }),
      ).toBe("NEEDS_REVIEW");
    },
  );

  it("returns READY at the exact threshold", () => {
    expect(
      determineStatus({
        score: 85,
        readinessThreshold: 85,
        hasBlocker: false,
        hasCriticalProblem: false,
        requiresHumanReview: false,
      }),
    ).toBe("READY");
  });

  it("lets a blocker override a high score", () => {
    expect(
      determineStatus({
        score: 100,
        readinessThreshold: 85,
        hasBlocker: true,
        hasCriticalProblem: false,
        requiresHumanReview: false,
      }),
    ).toBe("BLOCKED");
  });

  it("keeps a low score reviewable rather than blocked", () => {
    expect(
      determineStatus({
        score: 10,
        readinessThreshold: 85,
        hasBlocker: false,
        hasCriticalProblem: false,
        requiresHumanReview: false,
      }),
    ).toBe("NEEDS_REVIEW");
  });

  it("lets missing critical information override a high score", () => {
    expect(
      determineStatus({
        score: 100,
        readinessThreshold: 85,
        hasBlocker: false,
        hasCriticalProblem: true,
        requiresHumanReview: false,
      }),
    ).toBe("NEEDS_REVIEW");
  });

  it("lets mandatory review override a high score", () => {
    expect(
      determineStatus({
        score: 100,
        readinessThreshold: 85,
        hasBlocker: false,
        hasCriticalProblem: false,
        requiresHumanReview: true,
      }),
    ).toBe("NEEDS_REVIEW");
  });
});
