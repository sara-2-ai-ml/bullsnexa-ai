# BullsNexa Phase 1 readiness rubric

> **SYNTHETIC DEMO RULES — NOT OFFICIAL BULLS VISION GROUP POLICIES OR LEGAL GUIDANCE.**

This rubric is the human-readable contract for `syntheticRulesConfig` version `1.0.0`. The typed configuration is the runtime source of truth. Phase 1 evaluates structured fields only; it does not infer facts from free text or call an LLM.

## Score summary

| Component | Maximum |
| --- | ---: |
| Campaign completeness | 40 |
| Budget validity | 20 |
| Synthetic policy compliance | 25 |
| Measurable objective | 15 |
| **TOTAL** | **100** |

Every component is capped between zero and its maximum. The total is an integer from 0 through 100.

## 1. Campaign completeness — 40 points

A field receives its listed points only when it is present and valid. Missing or supplied-but-invalid values receive zero. Invalid values also produce a structured issue; they are never silently coerced.

| Field | Points | Classification |
| --- | ---: | --- |
| `campaignName` | 3 | **Critical** |
| `objective` | 6 | **Critical** |
| `targetAudience` | 4 | **Critical** |
| `targetCountry` | 5 | **Critical** |
| `channels` | 5 | **Critical** |
| `budgetAmount` | 5 | **Critical** |
| `currency` | 3 | **Critical** |
| `startDate` | 4 | **Critical** |
| `endDate` | 3 | **Critical** |
| `targetKpi` | 2 | **Critical** |
| **Total** | **40** | |

`category` is also critical because the prohibited-category policy must be evaluated, but its evidence is scored in policy compliance rather than completeness. `additionalNotes` is the only optional, unscored field.

Missing or invalid critical information always produces clarification questions and `NEEDS_REVIEW`, regardless of total score.

## 2. Budget validity — 20 points

| Criterion | Score |
| --- | ---: |
| Positive, finite numeric `budgetAmount` | 15 |
| Supported currency (`USD`, `EUR`, or `GBP`) | 5 |

- Missing budget: zero for the amount criterion and a clarification issue. It is not interpreted as zero or negative.
- Zero, negative, non-finite, or non-numeric supplied budget: zero for the amount criterion and a hard blocker.
- Missing or unsupported currency: zero for the currency criterion. Unsupported currency requires review but is not a hard blocker.
- A valid budget above 100,000 currency units keeps all 20 points but mandates human review under the synthetic budget policy.

## 3. Synthetic policy compliance — 25 points

Policy evidence is divided into independent subcomponents:

| Subcomponent | Maximum | Rule |
| --- | ---: | --- |
| Category | 8 | Allowed category: 8. Missing/invalid/prohibited: 0. Prohibited is a hard blocker. |
| Channels | 7 | All supported: 7. Deduct 4 per unsupported channel, capped at 7. Missing/unparseable: 0. |
| Dates | 5 | Valid same-day or later end date: 5. Past start deducts 3. Reversed dates or unavailable date evidence: 0. |
| Privacy review | 5 | Objective and country evaluable with no trigger: 5. EU lead-generation trigger deducts 3. Missing/invalid evidence: 0. |

The score never treats unavailable evidence as confirmed compliance: an unevaluable subcomponent gets zero. This can overlap with completeness deductions intentionally—completeness measures input quality, while policy scoring measures whether policy evidence can be established. Within policy compliance, each rule is applied only once and deductions are capped by its subcomponent maximum.

Policy references:

- `CAMPAIGN_REQUIREMENTS_V1` → `campaign-requirements.md`
- `BUDGET_POLICY_V1` → `budget-policy.md`
- `CHANNEL_GUIDELINES_V1` → `channel-guidelines.md`
- `PRIVACY_REVIEW_POLICY_V1` → `privacy-review-policy.md`
- `PROHIBITED_CATEGORIES_V1` → `prohibited-categories.md`

## 4. Measurable objective — 15 points

| Criterion | Score |
| --- | ---: |
| Supported objective enum value | 5 |
| KPI has an enumerated metric and positive finite `targetValue` | 5 |
| KPI metric is compatible with the objective mapping | 5 |

Supported objectives are `leads`, `sales`, `awareness`, `traffic`, and `app_installs`. KPI metrics and their compatible objectives are explicitly mapped in `src/domain/rules-config.ts`. Missing, unknown, vague, or contradictory values are not inferred from text. An unsupported objective requires clarification. An incompatible objective/KPI pair requires review.

The configuration's supported objective, KPI, channel, and currency lists are derived from the corresponding Zod enum options to prevent duplicate hardcoded lists. The KPI-to-objective mapping is intentionally policy-specific; consistency tests prove that every objective is mapped and every accepted KPI metric appears exactly once.

Unsupported-channel scoring remains conservative: each unique unsupported channel deducts 4 points from the 7-point channel subscore, capped at 7. Issues identify unsupported values deterministically and instruct the caller to remove or replace them.

## Technical evaluation errors

The rubric applies only after `today` passes ISO calendar-date validation. An invalid evaluator date returns `ok: false` with `INVALID_EVALUATION_DATE`; it has no campaign status, score, policy finding, or artificial blocker. A future application boundary must provide the real request date explicitly. The evaluator never reads the system clock.

## Status precedence and exact boundaries

Status is selected after scoring in this order:

1. Any hard business violation → `BLOCKED`.
2. Otherwise, missing or invalid critical information → `NEEDS_REVIEW`.
3. Otherwise, mandatory human review → `NEEDS_REVIEW`.
4. Otherwise, score below 85 → `NEEDS_REVIEW`.
5. Otherwise → `READY`.

Low score alone never produces `BLOCKED`. A high score never overrides a blocker, missing critical information, or mandatory review.

| Score | With no blocker, missing critical field, or review trigger |
| ---: | --- |
| 59 | `NEEDS_REVIEW` |
| 60 | `NEEDS_REVIEW` |
| 79 | `NEEDS_REVIEW` |
| 80 | `NEEDS_REVIEW` |
| 84 | `NEEDS_REVIEW` |
| 85 | `READY` |

For example, a score of 97 with the EU leads privacy trigger is still `NEEDS_REVIEW`, while a score of 95 with reversed dates is `BLOCKED`.

A same-day campaign with otherwise complete, compliant data scores all 5 date-policy points and can be `READY`.

## Country format and privacy trigger

Country input uses a trimmed, uppercase ISO 3166-1 alpha-2 representation such as `DE` or `US`. Normalization is limited to trimming and uppercasing; names such as `Germany` are not guessed. The versioned EU list in the typed configuration drives a synthetic review trigger: `objective === "leads"` and an EU country requires human review. This is an internal demonstration rule, not a claim that EU lead-generation campaigns violate privacy law.
