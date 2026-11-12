import Anthropic from "@anthropic-ai/sdk";

import { AnthropicProvider } from "./anthropic-provider.js";
import { createBriefExtractor, type BriefExtractor } from "./brief-extraction.js";
import { createSimulatedExtractorClient } from "./simulated-extractor.js";
import type { AgentProvider } from "./contracts.js";
import { MockProvider } from "./mock-provider.js";
import { createSimulatedClaudeClient } from "./simulated-claude.js";
import { createDefaultToolRegistry, type ToolRegistry } from "./tools.js";

export type AgentProviderMode = "mock" | "simulated" | "anthropic";

/** Sanitized configuration problem. The message never contains credential values. */
export class AgentConfigurationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentConfigurationError";
    this.code = code;
  }
}

/**
 * Application-boundary clock helper. The domain evaluator never reads the
 * system clock; callers inject this value as `today`. UTC calendar date.
 */
export function currentIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Builds the provider selected by AGENT_PROVIDER (default "mock").
 * There is no silent fallback: "anthropic" without credentials throws.
 * Create one provider per agent run; it keeps the run's conversation and
 * token totals.
 */
export function createProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  toolRegistry: ToolRegistry = createDefaultToolRegistry(),
): AgentProvider {
  const mode = (env.AGENT_PROVIDER?.trim().toLowerCase() || "mock") as string;

  if (mode === "mock") return new MockProvider();

  // Offline stand-in that speaks the real tool_use protocol. Not a real model.
  if (mode === "simulated") {
    return new AnthropicProvider({
      client: createSimulatedClaudeClient(),
      model: "simulated-claude",
      modeLabel: "simulated-claude",
      tools: toolRegistry,
    });
  }

  if (mode === "anthropic") {
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    const model = env.ANTHROPIC_MODEL?.trim();
    if (!apiKey) {
      throw new AgentConfigurationError(
        "MISSING_ANTHROPIC_API_KEY",
        "AGENT_PROVIDER=anthropic requires ANTHROPIC_API_KEY.",
      );
    }
    if (!model) {
      throw new AgentConfigurationError(
        "MISSING_ANTHROPIC_MODEL",
        "AGENT_PROVIDER=anthropic requires ANTHROPIC_MODEL.",
      );
    }
    // maxRetries 0: the orchestrator owns the single bounded retry.
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000 });
    return new AnthropicProvider({ client, model, tools: toolRegistry });
  }

  throw new AgentConfigurationError(
    "INVALID_AGENT_PROVIDER",
    "AGENT_PROVIDER must be 'mock', 'simulated' or 'anthropic'.",
  );
}

/**
 * Builds the brief extractor for the same AGENT_PROVIDER switch. mock and
 * simulated use the offline rule-based extractor (labeled as simulated);
 * anthropic uses the live model and never falls back silently.
 */
export function createExtractorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BriefExtractor {
  const mode = (env.AGENT_PROVIDER?.trim().toLowerCase() || "mock") as string;

  if (mode === "mock" || mode === "simulated") {
    return createBriefExtractor({
      client: createSimulatedExtractorClient(),
      model: "simulated-extractor",
      modeLabel: "simulated-extractor",
    });
  }

  if (mode === "anthropic") {
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    const model = env.ANTHROPIC_MODEL?.trim();
    if (!apiKey) {
      throw new AgentConfigurationError(
        "MISSING_ANTHROPIC_API_KEY",
        "AGENT_PROVIDER=anthropic requires ANTHROPIC_API_KEY.",
      );
    }
    if (!model) {
      throw new AgentConfigurationError(
        "MISSING_ANTHROPIC_MODEL",
        "AGENT_PROVIDER=anthropic requires ANTHROPIC_MODEL.",
      );
    }
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000 });
    return createBriefExtractor({ client, model });
  }

  throw new AgentConfigurationError(
    "INVALID_AGENT_PROVIDER",
    "AGENT_PROVIDER must be 'mock', 'simulated' or 'anthropic'.",
  );
}
