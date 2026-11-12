import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const calculatorInput = z.object({
  left: z.number(),
  right: z.number(),
});

function errorCategory(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "AUTHENTICATION";
  if (error instanceof Anthropic.RateLimitError) return "RATE_LIMIT";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "TIMEOUT";
  if (error instanceof Anthropic.APIConnectionError) return "NETWORK";
  if (error instanceof Anthropic.BadRequestError) return "BAD_REQUEST";
  if (error instanceof Anthropic.APIError) return `HTTP_${error.status ?? "UNKNOWN"}`;
  if (error instanceof z.ZodError) return "INVALID_TOOL_ARGUMENTS";
  return "UNKNOWN";
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim();

  if (!apiKey || !model) {
    console.log("SKIPPED: ANTHROPIC_API_KEY and ANTHROPIC_MODEL are required.");
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 128,
      tool_choice: { type: "tool", name: "add_numbers" },
      tools: [
        {
          name: "add_numbers",
          description: "Adds two harmless synthetic numbers.",
          input_schema: {
            type: "object",
            properties: {
              left: { type: "number" },
              right: { type: "number" },
            },
            required: ["left", "right"],
            additionalProperties: false,
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: "You must call add_numbers exactly once with left 2 and right 3.",
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");

    if (!toolUse || toolUse.type !== "tool_use" || toolUse.name !== "add_numbers") {
      console.error(`FAIL: model=${model} tool_use=false category=MISSING_TOOL_USE`);
      process.exitCode = 1;
      return;
    }

    const input = calculatorInput.parse(toolUse.input);
    if (input.left !== 2 || input.right !== 3) {
      console.error(`FAIL: model=${model} tool_use=true category=UNEXPECTED_TOOL_ARGUMENTS`);
      process.exitCode = 1;
      return;
    }

    console.log(`PASS: model=${model} tool_use=true`);
  } catch (error) {
    console.error(`FAIL: model=${model} tool_use=false category=${errorCategory(error)}`);
    process.exitCode = 1;
  }
}

void main();
