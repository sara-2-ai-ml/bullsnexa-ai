# BullsNexa

> BullsNexa is an independent technical-assignment prototype and is not an official Bulls Vision Group product.

BullsNexa is intended to turn a natural-language marketing campaign brief into a validated, actionable campaign launch-readiness plan. Phase 0 established the backend foundation; Phase 1 adds the deterministic domain layer that validates structured briefs and produces explainable readiness decisions. The AI agent is not implemented yet.

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
- Explainable 100-point scoring, structured issues/risks/questions, and `READY`, `NEEDS_REVIEW`, or `BLOCKED` status.
- EU lead-generation privacy-review trigger using a versioned EU country-code list.
- Fifteen evaluation fixtures: 8 executable domain cases and 7 explicitly deferred integration/security cases.
- Unit, policy-consistency, boundary, and dataset-integrity tests.

### Planned

- Structured brief extraction, a provider-neutral interface, and deterministic MockProvider mode.
- One plan-and-execute agent—not a multi-agent system—with at least two narrow tools.
- Bounded retries, refusals, execution traces, persistence, human approval, a minimal UI, and end-to-end evaluations.

### Not implemented

The repository contains no prompt orchestration, agent loop, tool execution, policy retrieval, database, approval workflow, frontend, or end-to-end AI workflow. Phase 1 evaluates structured objects only and does not interpret free text. Do not interpret the Anthropic smoke test or evaluation fixtures as an implemented agent.

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

It returns score components, validation issues, risks, clarification questions, policy references, rule version, human-review state, and a business status.

## Readiness model

> **SYNTHETIC DEMO RULES — NOT OFFICIAL BULLS VISION GROUP POLICIES OR LEGAL GUIDANCE.**

| Component | Maximum |
| --- | ---: |
| Campaign completeness | 40 |
| Budget validity | 20 |
| Synthetic policy compliance | 25 |
| Measurable objective | 15 |
| **Total** | **100** |

Hard violations—invalid supplied budgets, equal/reversed dates, or prohibited categories—produce `BLOCKED`. Missing critical information produces clarification questions and `NEEDS_REVIEW`. Explicit review triggers, including high budgets, unsupported fields, past start dates, incompatible objective/KPI pairs, and EU lead-generation privacy review, produce `NEEDS_REVIEW` unless a blocker takes precedence. Otherwise, a score of at least 85 is `READY`; low score alone is never `BLOCKED`.

Objectives are limited to `leads`, `sales`, `awareness`, `traffic`, and `app_installs`. KPI metrics and their allowed objective mappings are enumerated in the typed configuration. Country inputs use trimmed uppercase ISO alpha-2 codes; country names are not guessed.

See [docs/rubric.md](./docs/rubric.md) for exact weights, deductions, boundaries, and overlap rules. The runtime source of truth is [src/domain/rules-config.ts](./src/domain/rules-config.ts); synthetic policy documents provide reviewer context but cannot override typed rules.

## Domain data flow

```text
structured partial brief + explicit rules + explicit today
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

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Tests use `Fastify.inject()` for HTTP behavior and local pure functions for the domain layer. They cover schemas, budget/date/category rules, objective/KPI compatibility, score boundaries, the Germany privacy-review case, policy-reference consistency, determinism, and evaluation-dataset integrity. The seven future integration cases are schema-validated fixtures but are not executed or reported as passing agent tests.

## Optional Anthropic smoke test

Copy `.env.example` to `.env` and provide both values only when live provider verification is explicitly intended:

```dotenv
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
```

```bash
npm run smoke:anthropic
```

The smoke test is separate from the agent and test suite. Phase 1 does not call Anthropic; automated domain tests require no credentials or network access.

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

- The local host exposes Node 25.6.1 while the project targets Node 24 LTS; Node 24 CI confirmation remains advisable.
- Phase 1 accepts structured input only; free-text extraction and ambiguity resolution are future agent responsibilities.
- The country validator enforces the documented alpha-2 format but does not ship a complete ISO country registry.
- The rules and policy documents are synthetic demonstration material, not business or legal guidance.
- Phase 2 should introduce a provider-neutral structured extraction boundary and deterministic MockProvider behavior before bounded agent orchestration and tools.

See [ENGINEERING_LOG.md](./ENGINEERING_LOG.md) for the phase-by-phase engineering record.
