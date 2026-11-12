import {
  ChannelSchema,
  CurrencySchema,
  KpiMetricSchema,
  ObjectiveSchema,
  type KpiMetric,
  type Objective,
} from "./schemas.js";

export const SYNTHETIC_RULES_DISCLAIMER =
  "SYNTHETIC DEMO RULES — NOT OFFICIAL BULLS VISION GROUP POLICIES.";

export interface SyntheticRulesConfig {
  readonly version: string;
  readonly disclaimer: string;
  readonly score: {
    readonly completeness: {
      readonly maximum: 40;
      readonly fieldWeights: Readonly<Record<string, number>>;
      readonly criticalFields: readonly string[];
    };
    readonly budget: {
      readonly maximum: 20;
      readonly validAmount: 15;
      readonly supportedCurrency: 5;
    };
    readonly policyCompliance: {
      readonly maximum: 25;
      readonly categoryMaximum: 8;
      readonly channelsMaximum: 7;
      readonly datesMaximum: 5;
      readonly privacyMaximum: 5;
      readonly deductions: {
        readonly prohibitedCategory: 8;
        readonly unsupportedChannel: 4;
        readonly pastStartDate: 3;
        readonly invalidDateOrder: 5;
        readonly privacyReview: 3;
      };
    };
    readonly measurableObjective: {
      readonly maximum: 15;
      readonly supportedObjective: 5;
      readonly validKpi: 5;
      readonly compatibleKpi: 5;
    };
  };
  readonly readinessThreshold: number;
  readonly supportedObjectives: readonly string[];
  readonly supportedCurrencies: readonly string[];
  readonly supportedChannels: readonly string[];
  readonly supportedKpiMetrics: readonly string[];
  readonly countryFormat: "ISO_3166_1_ALPHA_2_UPPERCASE";
  readonly budgetReviewThreshold: number;
  readonly prohibitedCategories: readonly string[];
  readonly kpiMetricsByObjective: Readonly<Record<Objective, readonly KpiMetric[]>>;
  readonly euCountries: {
    readonly version: string;
    readonly sourceDescription: string;
    readonly codes: readonly string[];
  };
  readonly policies: Readonly<
    Record<
      | "campaignRequirements"
      | "budget"
      | "channels"
      | "privacy"
      | "prohibitedCategories",
      { readonly id: string; readonly file: string }
    >
  >;
}

export const syntheticRulesConfig = {
  version: "1.0.0",
  disclaimer: SYNTHETIC_RULES_DISCLAIMER,
  score: {
    completeness: {
      maximum: 40,
      fieldWeights: {
        campaignName: 3,
        objective: 6,
        targetAudience: 4,
        targetCountry: 5,
        channels: 5,
        budgetAmount: 5,
        currency: 3,
        startDate: 4,
        endDate: 3,
        targetKpi: 2,
      },
      criticalFields: [
        "campaignName",
        "objective",
        "targetAudience",
        "budgetAmount",
        "currency",
        "channels",
        "targetCountry",
        "startDate",
        "endDate",
        "targetKpi",
        "category",
      ],
    },
    budget: {
      maximum: 20,
      validAmount: 15,
      supportedCurrency: 5,
    },
    policyCompliance: {
      maximum: 25,
      categoryMaximum: 8,
      channelsMaximum: 7,
      datesMaximum: 5,
      privacyMaximum: 5,
      deductions: {
        prohibitedCategory: 8,
        unsupportedChannel: 4,
        pastStartDate: 3,
        invalidDateOrder: 5,
        privacyReview: 3,
      },
    },
    measurableObjective: {
      maximum: 15,
      supportedObjective: 5,
      validKpi: 5,
      compatibleKpi: 5,
    },
  },
  readinessThreshold: 85,
  supportedObjectives: ObjectiveSchema.options,
  supportedCurrencies: CurrencySchema.options,
  supportedChannels: ChannelSchema.options,
  supportedKpiMetrics: KpiMetricSchema.options,
  countryFormat: "ISO_3166_1_ALPHA_2_UPPERCASE",
  budgetReviewThreshold: 100_000,
  prohibitedCategories: ["tobacco", "weapons", "illegal_drugs"],
  kpiMetricsByObjective: {
    leads: ["leads", "cost_per_lead"],
    sales: ["purchases", "revenue", "return_on_ad_spend"],
    awareness: ["impressions", "reach"],
    traffic: ["clicks", "sessions"],
    app_installs: ["installs", "cost_per_install"],
  },
  euCountries: {
    version: "EU-27-2026-01",
    sourceDescription:
      "Synthetic snapshot of EU-27 ISO alpha-2 member-country codes for demo review routing.",
    codes: [
      "AT",
      "BE",
      "BG",
      "HR",
      "CY",
      "CZ",
      "DK",
      "EE",
      "FI",
      "FR",
      "DE",
      "GR",
      "HU",
      "IE",
      "IT",
      "LV",
      "LT",
      "LU",
      "MT",
      "NL",
      "PL",
      "PT",
      "RO",
      "SK",
      "SI",
      "ES",
      "SE",
    ],
  },
  policies: {
    campaignRequirements: {
      id: "CAMPAIGN_REQUIREMENTS_V1",
      file: "data/synthetic-policies/campaign-requirements.md",
    },
    budget: {
      id: "BUDGET_POLICY_V1",
      file: "data/synthetic-policies/budget-policy.md",
    },
    channels: {
      id: "CHANNEL_GUIDELINES_V1",
      file: "data/synthetic-policies/channel-guidelines.md",
    },
    privacy: {
      id: "PRIVACY_REVIEW_POLICY_V1",
      file: "data/synthetic-policies/privacy-review-policy.md",
    },
    prohibitedCategories: {
      id: "PROHIBITED_CATEGORIES_V1",
      file: "data/synthetic-policies/prohibited-categories.md",
    },
  },
} as const satisfies SyntheticRulesConfig;
