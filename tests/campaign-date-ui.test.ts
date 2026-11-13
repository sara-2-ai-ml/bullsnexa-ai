import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface DateState {
  startError: string;
  endError: string;
  warning: string;
  durationDays: number | null;
}

const html = readFileSync(resolve(process.cwd(), "public/app.html"), "utf8");
const app = readFileSync(resolve(process.cwd(), "public/js/app.js"), "utf8");
const utilities = readFileSync(resolve(process.cwd(), "public/js/campaign-validation.js"), "utf8").replaceAll("export ", "");

const { campaignDateState } = new Function(
  `${utilities}; return { campaignDateState };`,
)() as {
  campaignDateState: (start: string, end: string, today: string) => DateState;
};

describe("campaign schedule UI", () => {
  it("accepts a valid range and calculates duration inclusively", () => {
    expect(campaignDateState("2027-03-01", "2027-03-03", "2027-01-01")).toEqual({
      startError: "",
      endError: "",
      warning: "",
      durationDays: 3,
    });
  });

  it("accepts a same-day campaign as one day", () => {
    expect(campaignDateState("2027-03-01", "2027-03-01", "2027-01-01").durationDays).toBe(1);
  });

  it("reports an end date before the start date", () => {
    const state = campaignDateState("2027-03-03", "2027-03-01", "2027-01-01");
    expect(state.endError).toBe("End date must be on or after the start date.");
    expect(state.durationDays).toBeNull();
  });

  it("identifies each missing date", () => {
    const state = campaignDateState("", "", "2027-01-01");
    expect(state.startError).toBe("Select a start date to continue.");
    expect(state.endError).toBe("Select an end date to continue.");
  });

  it("rejects invalid calendar dates", () => {
    const state = campaignDateState("2027-02-29", "2027-03-01", "2027-01-01");
    expect(state.startError).toBe("Enter a valid start date.");
    expect(state.durationDays).toBeNull();
  });

  it("handles month and year boundaries with UTC calendar arithmetic", () => {
    expect(campaignDateState("2027-12-31", "2028-01-02", "2027-01-01").durationDays).toBe(3);
    expect(utilities).toContain("Date.UTC");
    expect(utilities).not.toMatch(/new Date\([^D]/);
  });

  it("shows the existing past-start review warning", () => {
    expect(campaignDateState("2026-12-31", "2027-01-02", "2027-01-01").warning).toBe(
      "This campaign starts in the past and may require review.",
    );
  });

  it("keeps extracted and manually edited ISO dates connected to the form payload", () => {
    expect(app).toContain('$("f-startDate").value = str(o.startDate)');
    expect(app).toContain('$("f-endDate").value = str(o.endDate)');
    expect(app).toContain('text("f-startDate", "startDate")');
    expect(app).toContain('text("f-endDate", "endDate")');
    expect(app).toContain("const brief = formToBrief()");
    expect(html).not.toContain('id="brief"');
  });
});
