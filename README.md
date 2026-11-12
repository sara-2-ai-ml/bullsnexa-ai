# BullsNexa

> BullsNexa is an independent technical-assignment prototype and is not an official Bulls Vision Group product.

BullsNexa is intended to turn a marketing campaign brief into a validated, actionable campaign launch-readiness plan. Phase 0 established the backend foundation, Phase 1 added deterministic readiness decisions, Phase 2A added a bounded provider-neutral agent, and Phase 2B adds focused per-operation reliability.

## Business problem

Campaign teams often receive incomplete briefs spread across free-form text. Important budget, audience, compliance, channel, and measurement details can be missed before launch. The planned system will interpret a brief, execute narrow tools, apply deterministic business rules, and produce structured JSON plus a readable readiness summary with an observable decision trail.

## Current scope

### Implemented — Phase 0

- Strict TypeScript, ESM, and NodeNext compilation.
- Fastify application factory and production server entry point.
- `GET /health`, consistent 404 responses, centralized safe error handling, and request IDs.
- Structured Pino logging with secret redaction and no request-body logging.
- Vitest API and logging-security tests.
- Optional Anthropic tool-use connectivity smoke test.
- Multi-stage, non-root, Debian-slim Docker foundation.

### Implemented — Phase 1

- Zod contracts for partial and fully validated campaign briefs.
- Structured objectives and KPI targets with deterministic compatibility rules.
- Versioned synthetic rule configuration and policy references.
- Pure `evaluateReadiness(brief, config, today)` evaluation with no network, database, clock, randomness, or LLM dependency.
- Discriminated success/error contract that keeps technical evaluator failures separate from campaign business decisions.
- Explainable 100-point scoring, structured issues/risks/questions, and `READY`, `NEEDS_REVIEW`, or `BLOCKED` status.
- EU lead-generation privacy-review trigger using a versioned EU country-code list.
- Fifteen evaluation fixtures: 8 executable domain cases and 7 explicitly deferred integration/security cases.
- Unit, policy-consistency, boundary, and dataset-integrity tests.

### Implemented — Phase 2A

- A bounded plan/tool/replan loop with separate technical execution and business readiness statuses.
- Strict provider actions, an authorized tool registry, zero-argument tool schemas, tool-call limits, planning-step limits, and repeated-action detection.
- `checkCampaignFields`, which exposes existing Phase 1 issue codes, severities, missing/invalid fields, and clarification questions without scoring or assigning business status.
- `evaluateCampaignReadiness`, which delegates business decisions exclusively to the existing Phase 1 evaluator.
- A deterministic `MockProvider` whose next action depends on actual prior tool output. It simulates provider decisions; it is not genuine LLM reasoning.
- In-memory execution traces and orchestrator-generated summaries grounded in verified results.

### Implemented — Phase 2B

- Configurable provider and tool timeouts, defaulting to 5 seconds per operation.
- Cooperative `AbortSignal` propagation for timeouts and caller cancellation.
- One retry by default, limited to explicitly classified transient failures on retry-safe providers or idempotent tools.
- Attempt and duration metadata on provider/tool trace events.
- Isolation of provider context and tool state snapshots so late results cannot update terminal agent state.

### Planned

- Natural-language brief extraction and real Claude provider integration.
- An overall run deadline and stronger isolation for operations that ignore cancellation.
- Persistence, human approval, a minimal UI, and broader end-to-end evaluations.

### Not implemented

The repository contains no natural-language extraction, real Claude agent provider, policy retrieval, database, approval workflow, frontend, advertising-platform integration, or ad publishing. Do not interpret the deterministic MockProvider, Anthropic smoke test, or evaluation fixtures as production AI automation.

## Technology

Node.js 24 LTS, npm, TypeScript, Fastify, Zod, Pino, Vitest, tsx, and the official Anthropic TypeScript SDK. Runtime code uses ES modules and NodeNext-compatible `.js` import specifiers so compiled output runs directly in Node.

## Local setup

Prerequisites: Node.js 24 and npm.

```bash
nvm use
npm ci
cp .env.example .env  # optional; only needed for the provider smoke test
npm run dev
```

The server defaults to `http://127.0.0.1:3000`. Override it with `HOST` and `PORT`. Production startup uses compiled JavaScript:

```bash
npm run build
npm start
```

## API foundation

`GET /health` returns HTTP 200:

```json
{
  "status": "ok",
  "service": "bulls-nexa"
}
```

Unknown routes return HTTP 404 using the shared safe envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found"
  },
  "requestId": "generated-request-id"
}
```

The Phase 1 evaluator is currently a domain API, not an HTTP endpoint:

```ts
evaluateReadiness(brief, syntheticRulesConfig, "2026-01-15");
```

Valid evaluation returns `{ ok: true, decision }`, where the decision contains score components, validation issues, risks, clarification questions, policy references, rule version, human-review state, and business status. An invalid `today` returns `{ ok: false, error: { code: "INVALID_EVALUATION_DATE", message } }` with no score or business status.

## Readiness model

> **SYNTHETIC DEMO RULES — NOT OFFICIAL BULLS VISION GROUP POLICIES OR LEGAL GUIDANCE.**

| Component | Maximum |
| --- | ---: |
| Campaign completeness | 40 |
| Budget validity | 20 |
| Synthetic policy compliance | 25 |
| Measurable objective | 15 |
| **Total** | **100** |

Hard violations—invalid supplied budgets, reversed dates, or prohibited categories—produce `BLOCKED`. Equal start/end dates are valid single-day campaigns and receive all 5 date-policy points. Missing critical information produces clarification questions and `NEEDS_REVIEW`. Explicit review triggers, including high budgets, unsupported fields, past start dates, incompatible objective/KPI pairs, and EU lead-generation privacy review, produce `NEEDS_REVIEW` unless a blocker takes precedence. Otherwise, a score of at least 85 is `READY`; low score alone is never `BLOCKED`.

Objectives are limited to `leads`, `sales`, `awareness`, `traffic`, and `app_installs`. KPI metrics and their allowed objective mappings are enumerated in the typed configuration. Country inputs use trimmed uppercase ISO alpha-2 codes; country names are not guessed.

Supported objective, KPI, channel, and currency lists in the rules configuration are derived from the Zod enums. The KPI-to-objective mapping remains a policy-specific mapping and is covered by drift tests. Unsupported-channel issues name only the unsupported values in sorted order and tell callers to remove or replace them.

See [docs/rubric.md](./docs/rubric.md) for exact weights, deductions, boundaries, and overlap rules. The runtime source of truth is [src/domain/rules-config.ts](./src/domain/rules-config.ts); synthetic policy documents provide reviewer context but cannot override typed rules.

## Domain data flow

```text
structured partial brief + explicit rules + explicit today
                 |
                 +--> invalid today --> technical error (no decision)
                 |
                 v
       field-level Zod validation
                 |
                 v
 deterministic rules and scoring
                 |
                 v
 status + score + issues + risks + clarification questions
```

## Phase 2A agent flow

The agent accepts an already structured campaign brief and an explicit evaluation date. Provider output is treated as untrusted and validated as one of four strict actions: `CALL_TOOL`, `ASK_USER`, `FINISH`, or `REFUSE`.

```text
structured brief + explicit today
              |
              v
       MockProvider decision
              |
              v
 checkCampaignFields ---- insufficient ----> clarification
              |
       sufficient or BLOCKER
              v
 evaluateCampaignReadiness
              |
      decision or technical error
              v
 orchestrator summary / safe failure
```

Both tools use the trusted brief and date held in agent state. Their argument schemas are strict empty objects, so a provider cannot replace the budget, dates, objective, policy configuration, or campaign data. The pre-check exposes the Phase 1 inspection findings but never computes a score or business status. `FINISH` is accepted only after a successful authoritative evaluation.

`MockProvider` chooses the evaluator or clarification path from the actual `checkCampaignFields` result, including BLOCKER precedence. The orchestrator generates the final summary from verified domain data; provider prose is not authoritative.

After building, generate three real synthetic traces (complete, incomplete, and controlled failure) with:

```bash
node dist/agent/demo-traces.js
```

Trace events contain correlation IDs, step, event type, tool name when applicable, outcome, sanitized error code, and attempt number. Measured `durationMs` is recorded only when a provider attempt or tool operation succeeds, fails, times out, or is cancelled; `TOOL_STARTED` does not claim an elapsed duration. Full campaign input is not copied into trace events. Trace and tool state are in memory only.

Each provider or tool attempt has its own finite timeout. Timeout aborts are cooperative: compatible handlers receive an `AbortSignal`, while `Promise.race`-style completion ensures the orchestrator stops waiting. This does not guarantee physical cancellation when an implementation ignores the signal. Such a late result cannot update terminal agent state because providers receive cloned context and tools execute against a cloned state snapshot, but an uncooperative operation could still perform its own external side effects.

Retries are deliberately narrow. The default is one retry, and it applies only when an operation throws `TransientAgentOperationError` and the provider declares `retrySafe: true` or the tool declares `idempotent: true`. Timeouts, cancellation, ordinary exceptions, validation failures, unknown/unauthorized tools, malformed arguments, refusals, clarification, and business decisions are never retried. A future Anthropic provider must coordinate SDK-level and orchestrator retry counts to avoid duplicate requests.

Phase 2B implements no overall run deadline; only individual provider and tool attempts are bounded. An externally supplied signal can cancel the active operation, but distributed cancellation and worker isolation are out of scope.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Tests use `Fastify.inject()` for HTTP behavior and local pure functions for the domain and agent layers. They cover schemas, business rules, score boundaries, dataset integrity, planning, strict validation, authorization, bounded execution, provider/tool timeouts, cancellation, safe retries, late-result isolation, deterministic summaries, and traces. The seven future integration cases remain schema-validated fixtures and are not counted as passing agent tests.

For real requests, a future application boundary or orchestrator must supply `today`; the evaluator never substitutes or reads the system date.

## Optional Anthropic smoke test

Copy `.env.example` to `.env` and provide both values only when live provider verification is explicitly intended:

```dotenv
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-haiku-5-5
```

```bash
npm run smoke:anthropic
```

The smoke test is separate from the agent and test suite. Automated domain and agent tests use no Anthropic credentials or network access.

## Docker

The multi-stage image compiles in a Debian build stage containing Python, Make, and a C++ compiler so a future native dependency such as `better-sqlite3` can be installed. The final Debian-slim image runs as the existing non-root `node` user and binds to `0.0.0.0`.

```bash
docker build -t bulls-nexa .
docker run --rm -p 3000:3000 bulls-nexa
```

Docker remains **NOT VERIFIED** in this workspace because the Docker CLI is unavailable. No successful image build or container health check is claimed.

## Real-world usage

**Not in production today.** Plausible users include a marketing agency checking client briefs before channel handoff, an in-house growth team standardizing launch gates, and a regulated brand preparing auditable approval packets. Production deployment would require authenticated access, secret management, tenant isolation, controlled business data, monitoring, retention rules, human approval for consequential actions, compliance/legal review, and ongoing model and rule evaluation.

## Limitations and roadmap

- Verification currently uses Node 25.6.1 while the project targets Node 24 LTS; Node 24 remains unverified in this environment.
- Phase 2B accepts structured input only; free-text extraction and ambiguity resolution are future integrations.
- The country validator enforces the documented alpha-2 format but does not ship a complete ISO country registry.
- The rules and policy documents are synthetic demonstration material, not business or legal guidance.
- The agent uses deterministic MockProvider decisions, not genuine LLM reasoning; real Claude tool calling is not implemented.
- There is no overall run deadline. Per-operation timeouts cannot physically stop code that ignores `AbortSignal`; worker isolation is not implemented.
- Persistence, approval workflows, and UI remain future work.

See [ENGINEERING_LOG.md](./ENGINEERING_LOG.md) for the phase-by-phase engineering record.
