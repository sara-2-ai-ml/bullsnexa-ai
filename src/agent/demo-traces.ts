import type { AgentAction, AgentProvider } from "./contracts.js";
import { MockProvider } from "./mock-provider.js";
import { runCampaignAgent } from "./orchestrator.js";

const completeBrief = {
  campaignName: "Synthetic Spring Launch",
  objective: "sales",
  targetAudience: "Synthetic retail audience",
  targetCountry: "US",
  channels: ["search", "social"],
  budgetAmount: 25_000,
  currency: "USD",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  targetKpi: { metric: "purchases", targetValue: 500 },
  category: "retail",
} as const;

const unknownToolProvider: AgentProvider = {
  async decideNextAction(): Promise<AgentAction> {
    return {
      type: "CALL_TOOL",
      toolName: "unregisteredTool",
      arguments: {},
    };
  },
};

async function demo(): Promise<void> {
  const scenarios = [
    {
      name: "complete",
      result: await runCampaignAgent({
        brief: completeBrief,
        today: "2026-01-15",
        provider: new MockProvider(),
      }),
    },
    {
      name: "incomplete",
      result: await runCampaignAgent({
        brief: { campaignName: "Synthetic Draft" },
        today: "2026-01-15",
        provider: new MockProvider(),
      }),
    },
    {
      name: "controlled-failure",
      result: await runCampaignAgent({
        brief: completeBrief,
        today: "2026-01-15",
        provider: unknownToolProvider,
      }),
    },
  ];

  console.log(
    JSON.stringify(
      scenarios.map(({ name, result }) => ({
        name,
        executionStatus: result.executionStatus,
        summary: result.summary,
        error: result.error,
        trace: result.executionHistory,
      })),
      null,
      2,
    ),
  );
}

await demo();
