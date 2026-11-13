import { describe, expect, it } from "vitest";

import { assessPlanQuality } from "../src/domain/plan-quality.js";
import { evaluateReadiness, syntheticRulesConfig } from "../src/domain/index.js";
import { buildApp } from "../src/app.js";

const TODAY = "2027-01-10";

const base = {
  campaignName: "Synthetic Spring Launch",
  objective: "sales",
  targetAudience: "Synthetic retail audience aged 25-44",
  targetCountry: "US",
  channels: ["search", "social"],
  budgetAmount: 25_000,
  currency: "USD",
  startDate: "2027-03-01",
  endDate: "2027-03-31",
  targetKpi: { metric: "purchases", targetValue: 500 },
  category: "retail",
};

function assess(overrides: Record<string, unknown> = {}, today = TODAY) {
  const brief = { ...base, ...overrides };
  const result = evaluateReadiness(brief, syntheticRulesConfig, today);
  if (!result.ok) throw new Error("evaluation failed");
  return assessPlanQuality(brief, result.decision, today);
}

const codes = (q: ReturnType<typeof assess>) => q?.signals.map((s) => s.code) ?? [];

describe("assessPlanQuality", () => {
  it("gives a sound plan 100 and no signals", () => {
    const q = assess();
    expect(q?.score).toBe(100);
    expect(q?.label).toBe("Strong");
    expect(q?.signals).toEqual([]);
  });

  it("separates two READY briefs that the readiness score cannot tell apart", () => {
    const sound = assess();
    const stretched = assess({ targetKpi: { metric: "purchases", targetValue: 20_000 } });
    expect(stretched?.score).toBeLessThan(sound?.score ?? 0);
    expect(codes(stretched)).toContain("KPI_TARGET_AMBITIOUS");
  });

  it("flags an ambitious KPI, a thin daily budget, a short flight, a short lead time, one channel and a vague audience", () => {
    const q = assess({
      budgetAmount: 60,
      channels: ["social"],
      targetAudience: "everyone",
      startDate: "2027-01-11",
      endDate: "2027-01-14",
      targetKpi: { metric: "purchases", targetValue: 100 },
    });
    expect(codes(q)).toEqual([
      "KPI_TARGET_AMBITIOUS",
      "THIN_DAILY_BUDGET",
      "SHORT_FLIGHT",
      "VERY_SHORT_LEAD_TIME",
      "SINGLE_CHANNEL",
      "BROAD_AUDIENCE",
    ]);
    expect(q?.score).toBe(100 - 25 - 20 - 10 - 15 - 5 - 5);
    expect(q?.label).toBe("Weak");
  });

  it("uses a cost per 1,000 for impressions and flags a low target", () => {
    const q = assess({ objective: "awareness", targetKpi: { metric: "impressions", targetValue: 100_000 } });
    expect(codes(q)).toEqual(["KPI_TARGET_LOW"]);
    expect(q?.signals[0]?.message).toContain("per 1,000 impressions");
    expect(q?.label).toBe("Strong");
  });

  it("gives no assessment to a blocked campaign or an unusable brief", () => {
    const brief = { ...base, budgetAmount: -500 };
    const result = evaluateReadiness(brief, syntheticRulesConfig, TODAY);
    if (!result.ok) throw new Error("evaluation failed");
    expect(result.decision.status).toBe("BLOCKED");
    expect(assessPlanQuality(brief, result.decision, TODAY)).toBeUndefined();
    expect(assessPlanQuality({ campaignName: "x" }, undefined, TODAY)).toBeUndefined();
  });

  it("is deterministic and does not change the readiness decision", () => {
    const brief = { ...base, targetKpi: { metric: "purchases", targetValue: 20_000 } };
    const result = evaluateReadiness(brief, syntheticRulesConfig, TODAY);
    if (!result.ok) throw new Error("evaluation failed");
    const before = JSON.stringify(result.decision);
    expect(assessPlanQuality(brief, result.decision, TODAY)).toEqual(
      assessPlanQuality(brief, result.decision, TODAY),
    );
    expect(JSON.stringify(result.decision)).toBe(before);
    expect(result.decision.score).toBe(100);
  });
});

describe("plan quality over HTTP", () => {
  it("is returned with a run and with the stored run", async () => {
    const app = buildApp({ today: () => TODAY });
    try {
      const run = (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: { brief: { ...base, targetKpi: { metric: "purchases", targetValue: 20_000 } } },
        })
      ).json();
      expect(run.decision.score).toBe(100);
      expect(run.planQuality.score).toBe(75);
      expect(run.planQuality.notice).toMatch(/never changes the readiness/);
      const stored = (await app.inject({ method: "GET", url: `/api/runs/${run.runId}` })).json();
      expect(stored.planQuality.signals.map((s: { code: string }) => s.code)).toEqual(["KPI_TARGET_AMBITIOUS"]);
    } finally {
      await app.close();
    }
  });
});
