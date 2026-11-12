import type Anthropic from "@anthropic-ai/sdk";

import type { AnthropicMessagesClient } from "./anthropic-provider.js";

/**
 * SIMULATED model for offline demos and tests. It speaks the real Anthropic
 * tool_use / tool_result protocol (matching ids included) but is NOT an LLM:
 * its choices are a few rules over the last tool result it was shown.
 * Results produced with it must never be described as real Claude output.
 */
export function createSimulatedClaudeClient(): AnthropicMessagesClient {
  let counter = 0;

  return {
    messages: {
      async create(params) {
        counter += 1;
        const last = params.messages[params.messages.length - 1];
        let name = "checkCampaignFields";
        let input: Record<string, unknown> = {};

        if (last && Array.isArray(last.content)) {
          const block = last.content.find((item) => item.type === "tool_result");
          const payload = JSON.parse(
            typeof block?.content === "string" ? block.content : "{}",
          ) as {
            tool?: string;
            canEvaluate?: boolean;
            issues?: { severity?: string }[];
            error?: string;
          };
          const hasBlocker = payload.issues?.some(
            (issue) => issue.severity === "BLOCKER",
          );

          if (payload.error) {
            name = "refuse";
            input = { code: "OUT_OF_SCOPE" };
          } else if (payload.tool === "checkCampaignFields") {
            if (hasBlocker) {
              name = "evaluateCampaignReadiness";
            } else if (payload.canEvaluate) {
              name = "searchCampaignPolicies";
              input = { query: "budget channels privacy review" };
            } else {
              name = "ask_user";
            }
          } else if (payload.tool === "searchCampaignPolicies") {
            name = "evaluateCampaignReadiness";
          } else {
            name = "finish";
          }
        }

        return {
          id: `msg_simulated_${counter}`,
          type: "message",
          role: "assistant",
          model: "simulated-claude",
          content: [
            {
              type: "tool_use",
              id: `toolu_simulated_${counter}`,
              name,
              input,
            },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        } as unknown as Anthropic.Messages.Message;
      },
    },
  };
}
