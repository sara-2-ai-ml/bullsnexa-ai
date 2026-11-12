import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CampaignEvaluationDatasetSchema } from "../src/domain/evaluation-dataset.js";
import { evaluateReadiness } from "../src/domain/readiness.js";
import { syntheticRulesConfig } from "../src/domain/rules-config.js";

const dataset = CampaignEvaluationDatasetSchema.parse(
  JSON.parse(
    readFileSync(resolve(process.cwd(), "evals/campaign-cases.json"), "utf8"),
  ),
);

describe("campaign evaluation dataset", () => {
  it("contains exactly 15 valid cases with unique IDs", () => {
    expect(dataset.cases).toHaveLength(15);
    expect(new Set(dataset.cases.map((item) => item.id)).size).toBe(15);
  });

  it("contains exactly 8 executable and 7 future integration cases", () => {
    const executable = dataset.cases.filter(
      (item) => item.executionScope === "READY_FOR_PHASE_1_TEST",
    );
    const future = dataset.cases.filter(
      (item) => item.executionScope === "FUTURE_INTEGRATION_CASE",
    );
    expect(executable).toHaveLength(8);
    expect(future).toHaveLength(7);
  });

  it("executes every Phase 1 case against independent expectations", () => {
    const executable = dataset.cases.filter(
      (item) => item.executionScope === "READY_FOR_PHASE_1_TEST",
    );

    for (const item of executable) {
      const result = evaluateReadiness(
        item.input,
        syntheticRulesConfig,
        dataset.today,
      );
      expect(result.status, item.id).toBe(item.expectedOutcome.status);
      expect(item.expectedScoreRange, item.id).toBeDefined();
      expect(result.score, item.id).toBeGreaterThanOrEqual(
        item.expectedScoreRange?.min ?? -1,
      );
      expect(result.score, item.id).toBeLessThanOrEqual(
        item.expectedScoreRange?.max ?? 101,
      );
      expect(
        result.risks.map((risk) => risk.code),
        item.id,
      ).toEqual(item.expectedRisks);
    }
  });

  it("does not execute or count future integration cases as Phase 1 passes", () => {
    const future = dataset.cases.filter(
      (item) => item.executionScope === "FUTURE_INTEGRATION_CASE",
    );
    for (const item of future) {
      expect(item.expectedOutcome.status).toBe("NOT_EXECUTED");
      expect(item.expectedScoreRange).toBeUndefined();
    }
  });

  it("case 7 explicitly asserts the Germany privacy-review behavior", () => {
    const item = dataset.cases.find(
      (candidate) => candidate.id === "case-07-germany-privacy-review",
    );
    expect(item).toBeDefined();
    const result = evaluateReadiness(
      item?.input,
      syntheticRulesConfig,
      dataset.today,
    );
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.requiresHumanReview).toBe(true);
    expect(result.validationIssues).toContainEqual(
      expect.objectContaining({
        code: "EU_LEADS_PRIVACY_REVIEW_REQUIRED",
        policyRef: "PRIVACY_REVIEW_POLICY_V1",
      }),
    );
  });
});
