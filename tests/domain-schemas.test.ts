import { describe, expect, it } from "vitest";

import {
  CampaignReadinessDecisionSchema,
  EvaluationResultSchema,
  PartialCampaignBriefSchema,
  TargetKpiSchema,
  ValidatedCampaignBriefSchema,
} from "../src/domain/schemas.js";
import { evaluateReadiness } from "../src/domain/readiness.js";
import { syntheticRulesConfig } from "../src/domain/rules-config.js";

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

describe("campaign domain schemas", () => {
  it("accepts a partial brief with optional fields missing", () => {
    expect(
      PartialCampaignBriefSchema.parse({ campaignName: "Draft" }),
    ).toEqual({ campaignName: "Draft" });
  });

  it("rejects missing fields in a fully validated brief", () => {
    expect(
      ValidatedCampaignBriefSchema.safeParse({ campaignName: "Draft" }).success,
    ).toBe(false);
  });

  it("rejects incorrect supplied field types", () => {
    expect(
      PartialCampaignBriefSchema.safeParse({ channels: "search" }).success,
    ).toBe(false);
  });

  it("rejects invalid supplied KPI numbers", () => {
    expect(
      TargetKpiSchema.safeParse({ metric: "clicks", targetValue: 0 }).success,
    ).toBe(false);
    expect(
      TargetKpiSchema.safeParse({ metric: "clicks", targetValue: Infinity })
        .success,
    ).toBe(false);
  });

  it("preserves a supplied negative budget for business validation", () => {
    const parsed = PartialCampaignBriefSchema.parse({ budgetAmount: -1 });
    expect(parsed.budgetAmount).toBe(-1);
  });

  it("normalizes a valid country code in validated input", () => {
    const parsed = ValidatedCampaignBriefSchema.parse({
      ...validBrief,
      targetCountry: " de ",
    });
    expect(parsed.targetCountry).toBe("DE");
  });

  it("accepts a complete valid campaign brief", () => {
    expect(ValidatedCampaignBriefSchema.safeParse(validBrief).success).toBe(true);
  });

  it("validates the structured readiness output schema", () => {
    const result = evaluateReadiness(
      validBrief,
      syntheticRulesConfig,
      "2026-01-15",
    );
    expect(EvaluationResultSchema.parse(result)).toEqual(result);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      expect.fail(`Unexpected technical error: ${result.error.code}`);
    }
    expect(CampaignReadinessDecisionSchema.parse(result.decision)).toEqual(
      result.decision,
    );
  });
});
