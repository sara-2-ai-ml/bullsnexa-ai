import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_PROJECT_ROOT } from "../src/agent/index.js";
import { exampleBriefNames, expectedPath, readJson, runAllExamples } from "../src/examples/index.js";

const root = DEFAULT_PROJECT_ROOT;
const all = await runAllExamples(root);

describe("sample inputs and expected outputs", () => {
  it("every sample input has an expected output file and vice versa", () => {
    const expectedFiles = readdirSync(path.join(root, "examples", "expected"))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    const wanted = [...exampleBriefNames(root), ...Object.keys(all.freeText).map((name) => `free-text-${name}`)].sort();
    expect(expectedFiles).toEqual(wanted);
  });

  it("actual outputs equal the committed expected outputs", () => {
    for (const [name, runs] of Object.entries(all.briefs)) {
      expect(runs.mock, name).toEqual(readJson(expectedPath(root, name)));
    }
    for (const [name, output] of Object.entries(all.freeText)) {
      expect(output, name).toEqual(readJson(expectedPath(root, `free-text-${name}`)));
    }
  });

  it("the committed values agree with independent expectations, not only with themselves", () => {
    const expected = (name: string) => all.briefs[name]!.mock;

    expect(expected("01-ready-campaign")).toMatchObject({ executionStatus: "COMPLETED", businessStatus: "READY", score: 100, handoff: "CLEARED", launchPlan: "AVAILABLE" });
    expect(expected("02-high-budget-needs-review")).toMatchObject({ businessStatus: "NEEDS_REVIEW", handoff: "PENDING_APPROVAL", risks: ["HIGH_BUDGET_REVIEW"] });
    expect(expected("03-eu-leads-privacy-review")).toMatchObject({ businessStatus: "NEEDS_REVIEW", score: 97, risks: ["EU_LEADS_PRIVACY_REVIEW"] });
    expect(expected("04-blocked-negative-budget")).toMatchObject({ businessStatus: "BLOCKED", score: 80, handoff: "NOT_ELIGIBLE", launchPlan: "BLOCKED_CAMPAIGN_HAS_NO_PLAN" });
    expect(expected("05-incomplete-needs-clarification")).toMatchObject({ executionStatus: "WAITING_FOR_CLARIFICATION", businessStatus: null, score: null });
    expect(expected("05-incomplete-needs-clarification").clarificationFields).toEqual(expect.arrayContaining(["objective", "budgetAmount"]));
    expect(expected("06-prompt-injection-in-notes")).toMatchObject({ businessStatus: "NEEDS_REVIEW", handoff: "PENDING_APPROVAL" });
    expect(expected("06-prompt-injection-in-notes").summary).not.toMatch(/READY/);
  });

  it("the mock provider and the simulated Claude provider reach the same trusted decision", () => {
    for (const [name, runs] of Object.entries(all.briefs)) {
      expect(runs.simulatedClaude.executionStatus, name).toBe(runs.mock.executionStatus);
      expect(runs.simulatedClaude.businessStatus, name).toBe(runs.mock.businessStatus);
      expect(runs.simulatedClaude.score, name).toBe(runs.mock.score);
      expect(runs.simulatedClaude.handoff, name).toBe(runs.mock.handoff);
    }
  });

  it("free text becomes a reviewable draft that the evaluator then judges", () => {
    const output = all.freeText["summer-sandals"]!;
    expect(output.extractor).toBe("simulated-extractor");
    expect(output.extractedFields).toEqual(expect.arrayContaining(["budgetAmount", "currency", "startDate", "endDate"]));
    expect(output.run.businessStatus).toBe("READY");
  });
});
