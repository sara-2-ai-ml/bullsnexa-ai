import { AgentConfigurationError, createProviderFromEnv, currentIsoDate } from "./provider-factory.js";
import { runCampaignAgent } from "./orchestrator.js";
import { CampaignReadinessDecisionSchema } from "../domain/schemas.js";

const EXPECTED_STATUS = "READY";
const REQUIRED_BUSINESS_TOOLS = [
  "checkCampaignFields",
  "evaluateCampaignReadiness",
] as const;

/**
 * OPT-IN live check: one real Claude run through the full agent.
 * Run with `npm run smoke:agent`. Prints only safe metadata.
 */
function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, AGENT_PROVIDER: "anthropic" };
  if (!env.ANTHROPIC_API_KEY?.trim() || !env.ANTHROPIC_MODEL?.trim()) {
    console.log("SKIPPED: ANTHROPIC_API_KEY and ANTHROPIC_MODEL are required.");
    return;
  }

  const today = currentIsoDate();
  const brief = {
    campaignName: "Synthetic Live Smoke Campaign",
    objective: "sales",
    targetAudience: "Synthetic retail audience",
    targetCountry: "US",
    channels: ["search", "social"],
    budgetAmount: 25_000,
    currency: "USD",
    startDate: addDays(today, 30),
    endDate: addDays(today, 59),
    targetKpi: { metric: "purchases", targetValue: 500 },
    category: "retail",
  };

  try {
    const provider = createProviderFromEnv(env);
    const result = await runCampaignAgent({ brief, today, provider });
    const tools = result.executionHistory
      .filter((event) => event.eventType === "TOOL_SUCCEEDED")
      .map((event) => event.toolName);
    const decision = CampaignReadinessDecisionSchema.safeParse(result.finalDecision);
    const usage = result.provider?.usage;
    const completedRealToolWorkflow =
      usage !== undefined &&
      usage.requests >= REQUIRED_BUSINESS_TOOLS.length + 1 &&
      usage.inputTokens > 0 &&
      usage.outputTokens > 0;
    const ok =
      result.provider?.mode === "anthropic" &&
      result.executionStatus === "COMPLETED" &&
      decision.success &&
      decision.data.status === EXPECTED_STATUS &&
      REQUIRED_BUSINESS_TOOLS.every((toolName) => tools.includes(toolName)) &&
      completedRealToolWorkflow;
    console.log(
      JSON.stringify(
        {
          result: ok ? "PASS" : "FAIL",
          providerMode: result.provider?.mode,
          executionStatus: result.executionStatus,
          businessStatus: result.finalDecision?.status,
          score: result.finalDecision?.score,
          executedTools: tools,
          errorCode: result.error?.code,
          usage,
        },
        null,
        2,
      ),
    );
    if (!ok) process.exitCode = 1;
  } catch (error) {
    const category =
      error instanceof AgentConfigurationError ? error.code : "UNEXPECTED_ERROR";
    console.error(`FAIL: category=${category}`);
    process.exitCode = 1;
  }
}

await main();
