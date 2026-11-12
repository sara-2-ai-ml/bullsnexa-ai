import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { syntheticRulesConfig } from "../src/domain/rules-config.js";
import { ChannelSchema, CurrencySchema } from "../src/domain/schemas.js";

describe("synthetic rules consistency", () => {
  it("has an explicit version and disclaimer", () => {
    expect(syntheticRulesConfig.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(syntheticRulesConfig.disclaimer).toContain("SYNTHETIC DEMO RULES");
  });

  it("weights the four scoring components to exactly 100", () => {
    expect(
      syntheticRulesConfig.score.completeness.maximum +
        syntheticRulesConfig.score.budget.maximum +
        syntheticRulesConfig.score.policyCompliance.maximum +
        syntheticRulesConfig.score.measurableObjective.maximum,
    ).toBe(100);
  });

  it("weights completeness fields to exactly 40", () => {
    expect(
      Object.values(
        syntheticRulesConfig.score.completeness.fieldWeights,
      ).reduce((sum, weight) => sum + weight, 0),
    ).toBe(40);
  });

  it("has valid deduction values within their subcomponent caps", () => {
    const { policyCompliance } = syntheticRulesConfig.score;
    expect(policyCompliance.deductions.prohibitedCategory).toBeLessThanOrEqual(
      policyCompliance.categoryMaximum,
    );
    expect(policyCompliance.deductions.unsupportedChannel).toBeGreaterThan(0);
    expect(policyCompliance.deductions.unsupportedChannel).toBeLessThanOrEqual(
      policyCompliance.channelsMaximum,
    );
    expect(policyCompliance.deductions.pastStartDate).toBeLessThanOrEqual(
      policyCompliance.datesMaximum,
    );
    expect(policyCompliance.deductions.invalidDateOrder).toBeLessThanOrEqual(
      policyCompliance.datesMaximum,
    );
    expect(policyCompliance.deductions.privacyReview).toBeLessThanOrEqual(
      policyCompliance.privacyMaximum,
    );
  });

  it("resolves every configured policy reference to an existing document", () => {
    for (const policy of Object.values(syntheticRulesConfig.policies)) {
      expect(policy.id).toMatch(/_V1$/);
      expect(existsSync(resolve(process.cwd(), policy.file))).toBe(true);
    }
  });

  it("contains the versioned EU-27 list including Germany", () => {
    expect(syntheticRulesConfig.euCountries.version).toBe("EU-27-2026-01");
    expect(syntheticRulesConfig.euCountries.codes).toHaveLength(27);
    expect(new Set(syntheticRulesConfig.euCountries.codes).size).toBe(27);
    expect(syntheticRulesConfig.euCountries.codes).toContain("DE");
  });

  it("keeps supported channel and currency schemas aligned with configuration", () => {
    expect(ChannelSchema.options).toEqual(syntheticRulesConfig.supportedChannels);
    expect(CurrencySchema.options).toEqual(
      syntheticRulesConfig.supportedCurrencies,
    );
  });
});
