# BullsNexa

> BullsNexa is an independent technical-assignment prototype and is not an official Bulls Vision Group product.

BullsNexa is intended to turn a natural-language marketing campaign brief into a validated, actionable campaign launch-readiness plan. Phase 0 establishes the secure, testable backend foundation only; it deliberately does not implement the AI agent or campaign workflow yet.

## Business problem

Campaign teams often receive incomplete briefs spread across free-form text. Important budget, audience, compliance, channel, and measurement details can be missed before launch. The planned system will interpret a brief, execute narrow tools, apply deterministic business rules, and produce both structured JSON and a readable readiness summary with an observable decision trail.

## Scope

### IMPLEMENTED — Phase 0

- Strict TypeScript, ESM, and NodeNext compilation.
- Fastify application factory and production server entry point.
- `GET /health`, consistent 404 responses, centralized safe error handling, and request IDs.
- Structured Pino logging with secret redaction and no request-body logging.
- Vitest API and logging-security tests.
- Optional real Anthropic tool-use connectivity smoke test.
- Multi-stage, non-root, Debian-slim Docker foundation.

### PLANNED

- One plan-and-execute AI agent, not a multi-agent system.
- Validated `CampaignBrief` domain schemas and deterministic policy rules.
- At least two narrow tools, provider and deterministic mock modes, bounded retries, refusals, and execution traces.
- Readiness scoring, human approval, SQLite persistence, a minimal UI, and an evaluation dataset.

### OUT OF SCOPE / NOT IMPLEMENTED

Phase 0 contains no campaign workflow, prompt orchestration, tool execution, database, readiness decision, human approval, frontend, or evaluation pipeline. Do not interpret the Anthropic smoke test as an agent.

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

## API

### `GET /health`

Returns HTTP 200:

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

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Tests use `Fastify.inject()` and do not bind a port. The production build can be checked manually with:

```bash
npm start
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/unknown
```

## Optional Anthropic smoke test

Copy `.env.example` to `.env` and provide both values. The model identifier is intentionally not guessed; use one enabled for your Anthropic account.

```dotenv
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
```

```bash
npm run smoke:anthropic
```

The script requests one harmless synthetic `add_numbers` tool call and validates its arguments. It prints only `PASS`, `FAIL`, or `SKIPPED`, a supplied model identifier when relevant, tool-use presence, and a sanitized error category. It never prints the key or raw provider response. Missing configuration produces `SKIPPED` and does not affect build, startup, or tests.

## Docker

The multi-stage image compiles in a Debian build stage containing Python, Make, and a C++ compiler so a future native dependency such as `better-sqlite3` can be installed. The final Debian-slim image runs as the existing non-root `node` user and binds to `0.0.0.0`.

```bash
docker build -t bulls-nexa .
docker run --rm -p 3000:3000 bulls-nexa
```

Docker is **NOT VERIFIED** in this Phase 0 workspace because the Docker CLI is unavailable. The Dockerfile has been reviewed but no successful image build or container health check is claimed.

## Real-world usage

**Not in production today.** Plausible users include a marketing agency checking client briefs before channel handoff, an in-house growth team standardizing campaign launch gates, and a regulated brand preparing auditable approval packets. Production deployment would require authenticated and authorized access, encrypted secret management, tenant isolation, provider/data-access controls, durable monitoring and alerting, retention policies, human approval for consequential actions, compliance/legal review, and ongoing model and rule evaluation.

## Limitations and next steps

- The local host exposes Node 25.6.1, while the project targets Node 24 LTS; all checks passed on the host, but a clean Node 24 CI run remains advisable.
- No live Anthropic call was made because credentials were not configured.
- Docker could not be executed locally.
- Phase 1 should add only the campaign brief schemas, deterministic business rules, and an initial synthetic evaluation dataset. Later phases can add the bounded single-agent loop and tools.

See [ENGINEERING_LOG.md](./ENGINEERING_LOG.md) for the Phase 0 architecture and observed verification results.
