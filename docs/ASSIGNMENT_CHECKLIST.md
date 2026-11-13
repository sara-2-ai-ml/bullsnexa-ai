# Assignment checklist: requirement, evidence, where to look

This page maps each requirement of the take-home brief to what BullsNexa does and where to verify it. Statuses are honest: **Done** means implemented and covered by tests or runnable commands; **Partly** and **Not verified** are called out.

Run everything offline (no API key): `npm ci`, `npm run typecheck`, `npm test`, `npm run eval`, `npm run examples`, `npm run build`, `npm run test:e2e`.

## 1. Core requirement

| Requirement | Our answer | Evidence |
| --- | --- | --- |
| At least one business workflow using an AI Agent approach | Campaign launch-readiness: a brief goes in; a decision (`READY`, `NEEDS_REVIEW`, `BLOCKED`), a launch plan and an audit trail come out. A tool-using agent with a bounded planner/executor loop, function calling and guardrails. | [How it works](../README.md#how-it-works), [orchestrator](../src/agent/orchestrator.ts), [tools](../src/agent/tools.ts) |
| Choose a framework or a custom orchestrator, and justify it | Custom orchestrator, no framework. Justified by four tools, one workflow, testable guardrails and a swappable provider. | [Trade-offs and decisions](../README.md#trade-offs-and-decisions) |

## 2. Minimum functional scope (must have)

| Requirement | Status | Our answer | Evidence |
| --- | --- | --- | --- |
| Agent orchestration: multi-step workflow, not a single prompt | Done | The model proposes one step at a time; the backend validates, authorizes and executes it, up to a decision. Typed state, max steps and max tool calls, repeated-action detection. | [orchestrator](../src/agent/orchestrator.ts), [agent tests](../tests/agent.test.ts), [Agent design](../README.md#agent-design) |
| At least 2 tools | Done | Four: `checkCampaignFields`, `searchCampaignPolicies`, `evaluateCampaignReadiness`, `createLaunchPlan`. | [tools](../src/agent/tools.ts), [policy search test](../tests/policy-search.test.ts), [launch plan test](../tests/launch-plan.test.ts) |
| Reliable outputs: structured JSON plus a human-readable summary | Done | Zod-validated response with status, score, reasons, plan, trace and a plain-language summary. | [Example inputs and expected outputs](../README.md#example-inputs-and-expected-outputs), [schemas](../src/domain/schemas.ts), [API tests](../tests/runs-api.test.ts) |
| Error handling and guardrails: retries, invalid input, refusal | Done | Input validation, one classified transient retry, per-operation timeouts, unauthorized-tool rejection, refusal path, prompt-injection boundaries. | [Reliability](../README.md#reliability), [reliability code](../src/agent/reliability.ts), [reliability tests](../tests/agent-reliability.test.ts), [eval cases](../evals/campaign-cases.json) |
| Observability: logs and traces of tool calls and the final decision | Done | Every run stores trace events (tool, duration, attempt, outcome); structured request logs; request counters at `/api/metrics`. | [Approval and observability](../README.md#approval-and-observability), [logger](../src/observability/logger.ts), [logging test](../tests/logging.test.ts) |
| Tests: basic unit tests plus at least 1 integration or end-to-end test | Done | 21 unit and integration files (270 tests) and 5 real-browser Playwright journeys. | [Evaluation checklist](../README.md#evaluation-checklist), [API integration tests](../tests/runs-api.test.ts), [browser E2E](../tests/e2e/campaign-workflow.spec.ts) |

## 3. README content

| Required in the README | Where |
| --- | --- |
| Problem statement (business context) | [Problem statement](../README.md#problem-statement) |
| What the agent does (scope and non-scope) | [How it works](../README.md#how-it-works), [Scope and non-scope](../README.md#scope-and-non-scope) |
| Business cases covered | [Business cases](../README.md#business-cases) |
| Architecture overview (components and data flow) | [Architecture](../README.md#architecture), [System design](./SYSTEM_DESIGN.md), [overview diagram](./system-overview.png) |
| Setup instructions (local run) | [Quick start](../README.md#quick-start), [Docker](../README.md#docker) |
| How to test and verify (unit, integration, manual scenarios) | [Evaluation checklist](../README.md#evaluation-checklist), [Manual scenarios](../README.md#manual-scenarios-about-3-minutes), [more scenarios](./TEST_SCENARIOS.md) |
| Example inputs and outputs | [Example inputs and expected outputs](../README.md#example-inputs-and-expected-outputs), [`examples/briefs`](../examples/briefs), [`examples/expected`](../examples/expected) |
| Trade-offs, limitations, next steps | [Trade-offs](../README.md#trade-offs-and-decisions), [Limitations](../README.md#limitations), [Next steps](../README.md#next-steps) |
| Is it used in a real business today? | [Real-world usage](../README.md#real-world-usage): **No.** Not in production; synthetic rules and data. |

## 4. Evaluation criteria

| Criterion | What to look at |
| --- | --- |
| Product thinking: is the business case clearly defined and solved? | [Problem statement](../README.md#problem-statement), [Business cases](../README.md#business-cases), [readiness vs plan quality](../README.md#readiness-score-vs-plan-quality) |
| Agent design quality: planning, tool use, state, prompt hygiene | [Agent design](../README.md#agent-design), [Trust boundaries](../README.md#trust-boundaries-prompt-hygiene), [orchestrator](../src/agent/orchestrator.ts) |
| Engineering quality: structure, typing, tests, readability, prompt-injection security | Strict TypeScript, Zod schemas, [tests](../tests), [CI workflow](../.github/workflows/ci.yml), [eval with injection cases](../evals/campaign-cases.json) |
| Reliability: edge cases, deterministic checks, validation | [rules](../src/domain/readiness.ts) (deterministic), [eval suite](../evals/campaign-cases.json) (15 cases), [Reliability](../README.md#reliability) |
| Clarity: README and instructions, easy to run and verify | [Quick start](../README.md#quick-start) (tested on a fresh clone), [Evaluation checklist](../README.md#evaluation-checklist) |
| Practicality: could a small team extend this? | [Repository layout](../README.md#repository-layout), [Limitations](../README.md#limitations), [Next steps](../README.md#next-steps), [System design](./SYSTEM_DESIGN.md) |

## 5. Submission

| Requirement | Status |
| --- | --- |
| Git repository link | Public repository |
| Source code | [`src`](../src), [`public`](../public) |
| README with setup and verification steps | [README](../README.md) |
| Sample inputs and expected outputs | [`examples`](../examples) |
| Tests and instructions to run them | [`tests`](../tests), [Evaluation checklist](../README.md#evaluation-checklist) |

## 6. What is not verified

Stated openly so nothing here is read as a claim: the Docker image has not been built or run by the author; Node 24 (the declared target) has not been run locally; the GitHub Actions workflow is defined but its results should be checked on GitHub; the 15 evaluation cases and extraction quality were not measured against live Claude (one live agent smoke run and a few manual extraction tries exist). See [Limitations](../README.md#limitations).
