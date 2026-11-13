import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(process.cwd(), "public/app.html"), "utf8");
const app = readFileSync(resolve(process.cwd(), "public/js/app.js"), "utf8");
const presentation = readFileSync(resolve(process.cwd(), "public/js/decision-model.js"), "utf8").replaceAll("export ", "");

const utilities = new Function(
  `${presentation}; return { decisionPresentation, targetCostInsight, recommendationFields };`,
)() as {
  decisionPresentation: (data: Record<string, any>) => Record<string, string>;
  targetCostInsight: (plan: Record<string, any>) => { amount: number; unit: string } | null;
  recommendationFields: (code: string) => [string, string][];
};

const ready = (label: "Strong" | "Fair" | "Weak", signals: unknown[] = []) => ({
  businessStatus: "READY",
  executionStatus: "COMPLETED",
  handoff: { approvalRequired: false },
  planQuality: { score: label === "Strong" ? 100 : 40, label, signals },
});

describe("Step 3 decision presentation", () => {
  it("presents READY with strong quality as two distinct positive assessments", () => {
    const view = utilities.decisionPresentation(ready("Strong"));
    expect(view.title).toBe("Required checks passed");
    expect(view.conclusion).toMatch(/no major planning concerns/);
  });

  it("does not present READY with weak quality as launch-ready", () => {
    const view = utilities.decisionPresentation(ready("Weak", [{ code: "KPI_TARGET_AMBITIOUS" }]));
    expect(view.title).toBe("Required checks passed; review the plan");
    expect(view.conclusion).toMatch(/launch plan needs attention/);
    expect(view.tone).toBe("review");
  });

  it.each([
    ["NEEDS_REVIEW", "Human review required"],
    ["BLOCKED", "Critical issues must be fixed"],
  ])("presents %s contextually", (businessStatus, title) => {
    expect(utilities.decisionPresentation({ businessStatus, executionStatus: "COMPLETED" }).title).toBe(title);
  });

  it("handles clarification, refusal and failure without exposing internal codes", () => {
    expect(utilities.decisionPresentation({ executionStatus: "WAITING_FOR_CLARIFICATION" }).title).toMatch(/details are needed/);
    expect(utilities.decisionPresentation({ executionStatus: "REFUSED" }).title).toMatch(/safely refused/);
    expect(utilities.decisionPresentation({ executionStatus: "FAILED" }).title).toMatch(/could not be completed/);
  });

  it("calculates target-derived cost only for meaningful KPI types", () => {
    const purchases = utilities.targetCostInsight({ budget: { total: 900 }, kpi: { metric: "purchases", targetValue: 5000 } });
    expect(purchases).toEqual(expect.objectContaining({ amount: 0.18, unit: "per purchase" }));
    const reach = utilities.targetCostInsight({ budget: { total: 1000 }, kpi: { metric: "reach", targetValue: 200000 } });
    expect(reach).toEqual(expect.objectContaining({ amount: 5, unit: "per 1,000 reach" }));
    expect(utilities.targetCostInsight({ budget: { total: 900 }, kpi: { metric: "return_on_ad_spend", targetValue: 3 } })).toBeNull();
  });

  it("maps recommendations to editable form fields", () => {
    expect(utilities.recommendationFields("KPI_TARGET_AMBITIOUS")).toEqual([
      ["f-budgetAmount", "Review budget"],
      ["f-kpiValue", "Review KPI target"],
    ]);
    expect(utilities.recommendationFields("SINGLE_CHANNEL")).toEqual([["f-channels", "Review channels"]]);
    expect(app).toContain("target.focus({ preventScroll: true })");
  });

  it("marks an assessment stale after form changes and protects approval actions", () => {
    expect(app).toContain("Campaign details changed. This assessment is no longer current.");
    expect(app).toContain('root.querySelectorAll(".approve button")');
    expect(app).toContain("markAssessmentStale()");
  });

  it("keeps technical metadata collapsed and JSON editing absent", () => {
    expect(app).toContain('h("details", "technical")');
    expect(app).toContain('"Technical details"');
    expect(html).not.toContain('id="brief"');
  });
});
