import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  AnthropicProvider,
  DEFAULT_PROJECT_ROOT,
  MockProvider,
  createBriefExtractor,
  createDefaultToolRegistry,
  createSimulatedClaudeClient,
  createSimulatedExtractorClient,
  runCampaignAgent,
  type AgentProvider,
  type AgentResult,
} from "../agent/index.js";
import { deriveHandoff } from "../approval/handoff.js";
import { createLaunchPlan } from "../domain/launch-plan.js";

/** Fixed so documented outputs do not drift with the system clock. */
export const EXAMPLES_TODAY = "2026-11-12";

export interface ExampleOutput {
  readonly example: string;
  readonly today: string;
  readonly executionStatus: string;
  readonly businessStatus: string | null;
  readonly score: number | null;
  readonly handoff: string;
  readonly tools: readonly string[];
  readonly clarificationFields: readonly string[];
  readonly risks: readonly string[];
  readonly launchPlan: string | null;
  readonly summary: string;
}

export interface FreeTextOutput {
  readonly example: string;
  readonly today: string;
  readonly extractor: string;
  readonly extractedFields: readonly string[];
  readonly droppedFields: readonly string[];
  readonly brief: unknown;
  readonly run: ExampleOutput;
}

export const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

function simulatedClaude(): AgentProvider {
  return new AnthropicProvider({
    client: createSimulatedClaudeClient(),
    model: "simulated-claude",
    modeLabel: "simulated-claude",
    tools: createDefaultToolRegistry(),
  });
}

export function describeRun(example: string, brief: unknown, result: AgentResult): ExampleOutput {
  const decision = result.finalDecision;
  const plan = decision ? createLaunchPlan(brief, decision) : undefined;
  return {
    example,
    today: EXAMPLES_TODAY,
    executionStatus: result.executionStatus,
    businessStatus: decision?.status ?? null,
    score: decision?.score ?? null,
    handoff: deriveHandoff(
      { runId: result.runId, executionStatus: result.executionStatus, brief, decision },
      undefined,
    ).status,
    tools: result.toolResults.map((entry) => entry.toolName),
    clarificationFields: result.clarificationQuestions.map((question) => question.fieldPath),
    risks: decision?.risks.map((risk) => risk.code) ?? [],
    launchPlan: plan ? (plan.ok ? "AVAILABLE" : plan.reason) : null,
    summary: result.summary,
  };
}

export async function runBriefExample(
  name: string,
  brief: unknown,
  provider: AgentProvider = new MockProvider(),
): Promise<ExampleOutput> {
  const result = await runCampaignAgent({ brief, today: EXAMPLES_TODAY, provider });
  return describeRun(name, brief, result);
}

export async function runFreeTextExample(name: string, text: string): Promise<FreeTextOutput> {
  const extracted = await createBriefExtractor({
    client: createSimulatedExtractorClient(),
    model: "simulated-extractor",
    modeLabel: "simulated-extractor",
  }).extract(text, { today: EXAMPLES_TODAY });
  return {
    example: name,
    today: EXAMPLES_TODAY,
    extractor: extracted.mode,
    extractedFields: extracted.extractedFields,
    droppedFields: extracted.droppedFields,
    brief: extracted.brief,
    run: await runBriefExample(name, extracted.brief),
  };
}

export const exampleBriefNames = (rootDir: string): string[] =>
  readdirSync(path.join(rootDir, "examples", "briefs"))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => file.replace(/\.json$/, ""));

export const expectedPath = (rootDir: string, name: string): string =>
  path.join(rootDir, "examples", "expected", `${name}.json`);

export interface AllExamples {
  readonly briefs: Record<string, { mock: ExampleOutput; simulatedClaude: ExampleOutput }>;
  readonly freeText: Record<string, FreeTextOutput>;
}

export async function runAllExamples(rootDir: string = DEFAULT_PROJECT_ROOT): Promise<AllExamples> {
  const briefs: AllExamples["briefs"] = {};
  for (const name of exampleBriefNames(rootDir)) {
    const brief = readJson(path.join(rootDir, "examples", "briefs", `${name}.json`));
    briefs[name] = {
      mock: await runBriefExample(name, brief),
      simulatedClaude: await runBriefExample(name, brief, simulatedClaude()),
    };
  }
  const freeText: AllExamples["freeText"] = {};
  const dir = path.join(rootDir, "examples", "free-text");
  for (const file of readdirSync(dir).filter((entry) => entry.endsWith(".txt")).sort()) {
    const name = file.replace(/\.txt$/, "");
    freeText[name] = await runFreeTextExample(name, readFileSync(path.join(dir, file), "utf8"));
  }
  return { briefs, freeText };
}
