import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page): Promise<void> {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Username").fill("reviewer");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("demo-pass-1234");
  await page.getByRole("button", { name: "Open the app" }).click();
  await expect(page.getByRole("heading", { name: "Check a campaign before it launches." })).toBeVisible();
}

test.beforeEach(async ({ page }) => signIn(page));

test("campaign description is extracted, reviewed and assessed", async ({ page }) => {
  await page.getByLabel("In your own words (optional)").fill(
    'Called "Winter Boots". Objective: sales. Audience: outdoor shoppers. Budget $25,000 on Google and Instagram in the US, 2027-01-10 to 2027-02-10, aim for 500 purchases. Category: retail.',
  );
  await page.getByRole("button", { name: "Extract fields" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Campaign details added" })).toBeVisible();
  await expect(page.getByLabel("Campaign name")).toHaveValue("Winter Boots");
  await page.getByLabel("Target audience").fill("Outdoor shoppers aged 25 to 45");
  await page.getByRole("button", { name: "Run agent" }).click();
  await expect(page.getByText("Required checks passed", { exact: true })).toBeVisible();
  await expect(page.getByText("Rule readiness", { exact: true })).toBeVisible();
  await expect(page.getByText(/Plan quality ·/)).toBeVisible();
});

test("form validation covers missing, reversed and same-day dates plus KPI compatibility", async ({ page }) => {
  await page.getByRole("button", { name: "Complete brief", exact: true }).click();
  const start = page.getByLabel("Start date");
  const end = page.getByLabel("End date");
  await start.fill("");
  await expect(page.getByText("Select a start date to continue.")).toBeVisible();
  await start.fill("2027-03-03");
  await end.fill("2027-03-01");
  await expect(page.getByText("End date must be on or after the start date.")).toBeVisible();
  await end.fill("2027-03-03");
  await expect(page.getByText("Campaign duration: 1 day")).toBeVisible();
  await page.getByLabel("Campaign objective").selectOption("awareness");
  await expect(page.getByLabel("Success metric", { exact: true })).not.toHaveValue("purchases");
  await page.getByLabel("Campaign objective").selectOption("sales");
  await page.getByLabel("Success metric", { exact: true }).selectOption("purchases");
  await page.getByLabel("Total budget").fill("-1");
  await page.getByRole("button", { name: "Run agent" }).click();
  await expect(page.getByText("Critical issues must be fixed", { exact: true })).toBeVisible();
});

test("READY, NEEDS_REVIEW and BLOCKED decisions remain distinct and editable", async ({ page }) => {
  await page.getByRole("button", { name: "Complete brief", exact: true }).click();
  await page.getByRole("button", { name: "Run agent" }).click();
  await expect(page.getByText("Required checks passed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "High budget", exact: true }).click();
  await page.getByRole("button", { name: "Run agent" }).click();
  await expect(page.getByText("Human review required", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Prompt injection", exact: true }).click();
  await page.getByRole("button", { name: "Run agent" }).click();
  await expect(page.getByText("Critical issues must be fixed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review field" }).first()).toBeVisible();
  await page.getByLabel("Campaign name").fill("Changed after assessment");
  await expect(page.getByText(/assessment is no longer current/i)).toBeVisible();
});

test("eligible handoff can be approved once and stale assessments cannot approve", async ({ page }) => {
  await page.getByRole("button", { name: "High budget", exact: true }).click();
  await page.getByRole("button", { name: "Run agent" }).click();
  await page.getByLabel("Reviewer name").fill("E2E Reviewer");
  await page.getByRole("button", { name: "Approve handoff" }).click();
  await expect(page.getByText("Approved for handoff")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve handoff" })).toHaveCount(0);

  await page.getByRole("button", { name: "High budget", exact: true }).click();
  await page.getByRole("button", { name: "Run agent" }).click();
  await page.getByLabel("Campaign name").fill("Stale campaign");
  await expect(page.getByRole("button", { name: "Approve handoff" })).toBeDisabled();
});

test("history opens completed runs and workflow remains keyboard and mobile usable", async ({ page }) => {
  await page.getByRole("button", { name: "Complete brief", exact: true }).click();
  await page.getByLabel("Campaign name").fill("History keyboard campaign");
  await page.getByLabel("Campaign name").press("Control+Enter");
  await expect(page.getByText("Required checks passed", { exact: true })).toBeVisible();
  const historyRun = page.getByRole("button", { name: /^History keyboard campaign/ });
  await expect(historyRun).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await historyRun.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Required checks passed", { exact: true })).toBeVisible();
});
