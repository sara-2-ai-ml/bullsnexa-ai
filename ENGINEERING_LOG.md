# BullsNexa Engineering Log

Incremental build diary for BullsNexa. This log records what exists, why it exists, and how it was actually verified. Its phase-oriented, evidence-first structure was informed by the read-only [PILOT AI engineering log](https://github.com/sara-2-ai-ml/pilot-flight-agent/blob/main/ENGINEERING_LOG.md); no PILOT code was copied or modified.

> **Reading note.** This log is chronological. Statements in an earlier phase describe the project at that time (for example, test counts or "not yet implemented" items); the README is the current source of truth.

## Current System Snapshot

As of 2026-11-13, BullsNexa is a complete technical-assignment prototype spanning Phases 0–7. It is **not in production today**. Historical sections below remain unchanged as dated records of what existed at each phase; this snapshot describes the current repository.

### Architecture and workflow

The application is a Node.js/Fastify service with a same-origin browser UI, a provider-neutral custom agent orchestrator, deterministic campaign-domain logic, bounded synthetic-policy retrieval, SQLite persistence, and a plan-bound human approval layer. The detailed component, sequence, security, deployment, and design-pattern documentation is maintained in [docs/SYSTEM_DESIGN.md](./docs/SYSTEM_DESIGN.md).

The main workflow is:

1. A user supplies a structured brief or requests natural-language extraction.
2. Extraction returns a validated, editable draft; it never starts the campaign agent automatically.
3. The user explicitly runs the agent.
4. A selected provider proposes one strictly validated action at a time.
5. The orchestrator authorizes and executes business tools against trusted state.
6. The deterministic readiness engine produces `READY`, `NEEDS_REVIEW`, or `BLOCKED`, with score, issues, risks, questions, and policy references.
7. The API builds a deterministic launch plan where permitted, persists the run and trace, and derives the handoff state.
8. A persisted `NEEDS_REVIEW` run may be approved or rejected by a person; `BLOCKED` and unpersisted runs cannot be approved.

### Providers and authorized tools

Provider modes are `mock` (deterministic offline), `simulated` (offline rule-based client using the Anthropic tool-use protocol), and `anthropic` (real Messages API, explicitly configured, with no silent fallback). The four authorized business tools are:

- `checkCampaignFields` — exposes authoritative field issues and questions without scoring;
- `searchCampaignPolicies` — returns bounded, cited excerpts from five synthetic policy documents;
- `evaluateCampaignReadiness` — delegates exclusively to the deterministic domain evaluator;
- `createLaunchPlan` — derives a deterministic plan after successful evaluation.

Control actions are `ask_user`, `finish`, and `refuse`. The model cannot set a readiness score/status, alter trusted campaign fields or rules through tool arguments, approve a run, publish a campaign, or spend money.

### Reliability, persistence, and security

The orchestrator enforces strict Zod action schemas, tool authorization, tool preconditions, maximum planning steps and tool calls, repeated-action detection, finite provider/tool timeouts, cooperative cancellation, and one narrowly classified transient retry. Trace events record correlation IDs, outcomes, attempts, sanitized error codes, and measured durations where elapsed time exists. Live usage aggregates provider-reported requests and tokens.

SQLite stores runtime-validated runs, ordered trace events, and at most one approval per run. Approval integrity uses the v2 SHA-256 domain `bullsnexa:approval-plan:v2`, binding the specific `runId`, brief, trusted decision, and derived launch plan. Corrupt stored JSON fails closed, concurrent approvals cannot both succeed, and a persisted data change invalidates an earlier approval.

Security boundaries include bounded input, request-size limits, fixed policy paths, strict provider/tool output validation, Pino redaction, no request-body logging, sanitized client errors, same-origin UI requests, restrictive CSP, and text-only dynamic DOM rendering. Production authentication, RBAC, tenant isolation, rate limiting, secret management, immutable auditing, and paid-model quotas are not implemented.

### API, UI, evaluation, and current verification

The API provides health, configuration, extraction, agent execution, history, detail, and approval endpoints. The homepage links to a guided UI that supports extraction, editable form/JSON input, explicit agent execution, decisions, score explanations, risks, launch plans, traces, token usage, history, and approval. Approval controls are hidden when persistence fails.

The offline suite covers domain rules, agent orchestration, Anthropic protocol handling, extraction, policy retrieval, reliability, persistence, approval integrity, API behavior, static Docker configuration, executable examples, and the 15-case evaluation. The latest confirmed publication verification is:

| Check | Current confirmed result |
| --- | --- |
| Typecheck | PASS |
| Automated tests | PASS — 225/225 across 17 files |
| Agent evaluations | PASS — 15/15 |
| Executable examples | PASS — 7/7 |
| Production build | PASS |
| Verification runtime | Node.js 25.6.1 on Windows |
| Declared target | Node.js 24; not yet verified |
| Live Claude | One documented successful smoke run only; not a live evaluation suite |
| Docker runtime | Not verified; Dockerfile checks are static |

The architecture deliberately uses a small custom orchestrator rather than LangGraph or a multi-agent graph. Confirmed patterns include provider Strategy, environment-backed Factory, explicit State Machine, structured action Command, authorized tool Registry, SQLite Repository, and function/options-based Dependency Injection. Strategy, Factory, and Command are GoF-inspired; State Machine, Registry, and Repository are architectural patterns; Dependency Injection is a composition technique.

## Phase 0 — Backend foundation

Status: complete, with Docker execution not verified and the optional provider smoke test skipped because credentials were absent.

### 1. Concept

A backend foundation is the smallest dependable boundary around application behavior. It accepts requests through a defined protocol, validates runtime configuration, routes requests to isolated handlers, returns predictable responses, records safe operational evidence, and can start and stop cleanly. It should also be testable without depending on a real network port or third-party service.

This phase intentionally creates that boundary before any AI behavior. A model cannot compensate for an unreliable server, ambiguous error contracts, leaked credentials, or untestable state transitions.

### 2. Why it matters

An AI agent will eventually combine probabilistic interpretation with deterministic business operations. The HTTP boundary must make failures understandable to callers. Configuration must fail early rather than silently choosing dangerous values. Logs must connect an incident to a request without exposing the brief or secrets. Tests need an app factory so deterministic behavior can be verified without starting a background server.

Building these properties first prevents later agent code from becoming coupled to process startup, global network state, or ad hoc logging.

### 3. Architecture

```text
HTTP client
    |
    v
Fastify request lifecycle -- requestId
    |
    +--> GET /health --> health route --> 200 JSON
    |
    +--> unknown route --> not-found handler --> 404 error JSON
    |
    +--> unexpected error --> centralized handler --> safe 500 JSON
    |
    v
Pino structured request/response logs (sensitive paths redacted)
```

`buildApp()` owns the transport-independent application. `server.ts` owns runtime configuration, socket binding, startup failure handling, and signal shutdown. This separation allows `Fastify.inject()` to exercise the complete request lifecycle in memory.

Every HTTP request has a `requestId`. A valid, bounded `x-request-id` is accepted; otherwise a UUID is generated. A future `traceId` has a different purpose: it will identify one AI execution across planning steps, retries, and tool calls, potentially spanning more than one internal operation. Phase 0 does not invent agent traces or execution events.

### 4. Implementation

- `src/app.ts` builds Fastify, validates/generates request IDs, registers routes, and defines shared 404 and 500 responses. Stack traces remain in internal error logs and are never returned to clients.
- `src/server.ts` validates `HOST` and `PORT` with Zod, listens with safe local defaults, and handles `SIGINT`/`SIGTERM` shutdown.
- `src/routes/health.ts` contains the narrow liveness route.
- `src/observability/logger.ts` defines Pino redaction and a request serializer limited to method, URL, and request ID. It does not serialize request bodies.
- `scripts/smoke-anthropic.ts` performs an optional, isolated official-SDK tool-use request and validates the untrusted tool arguments with Zod.
- `tests/health.test.ts` verifies the application factory, health response, and 404 contract through injection.
- `tests/logging.test.ts` proves representative authorization/token/password values are redacted.
- `Dockerfile` separates native-capable dependency/build stages from a small non-root runtime stage.
- `tsconfig.json` enforces strict NodeNext ESM semantics; `tsconfig.build.json` emits only production source.
- `.env.example`, `.gitignore`, and `.dockerignore` define safe configuration and context boundaries.

The `agent`, `tools`, `domain`, `evals`, `public`, and `docs` directories contain only `.gitkeep` files. They reserve the requested structure without pretending later-phase modules exist.

### 5. Data flow: `GET /health`

1. A client connects to Fastify and requests `/health`.
2. Fastify reads `x-request-id`. The app keeps it only if it matches the bounded safe-character pattern; otherwise it generates a UUID.
3. Pino records an incoming-request event with the request ID and the limited request serializer. The body is not logged.
4. Fastify dispatches to `healthRoutes`.
5. The handler returns `{ "status": "ok", "service": "bulls-nexa" }`.
6. Fastify serializes the object as JSON with HTTP 200.
7. Pino records completion, status, duration, and the same request ID.

### 6. Engineering decisions

- **TypeScript:** strict compile-time checks make transport, configuration, and future tool contracts explicit.
- **Fastify:** its plugin model, schema-friendly architecture, Pino integration, and in-memory injection keep the backend small and testable.
- **ESM / NodeNext:** this matches modern Node execution. Local imports use `.js` extensions so emitted JavaScript runs without `tsx`.
- **Vitest:** it provides fast TypeScript-aware tests with a concise assertion API.
- **Structured logging:** machine-readable events enable monitoring and incident correlation. Explicit redaction and narrow serializers reduce accidental data disclosure.
- **Docker Debian slim:** Debian has a predictable glibc/native-build environment. The build stage includes the toolchain needed by a future `better-sqlite3` dependency; Alpine/musl-specific friction is avoided.
- **Node 24 LTS:** `.nvmrc`, `engines`, types, and Docker converge on one supported LTS major. The available host was Node 25.6.1, so a Node 24 CI confirmation remains a risk item.
- **Native environment/type support for smoke:** Node 24 can load `.env` with `--env-file-if-exists` and run erasable TypeScript directly. `tsx` remains the development runner. This also avoids a verified Node 25/Windows host failure inside `tsx` before application code executes.

### 7. Failure modes

- **Invalid `HOST` or `PORT`:** Zod rejects startup configuration; the server logs a fatal internal event and does not listen.
- **Port already in use or bind failure:** the startup catch path logs safely, sets a failing exit code, and closes resources.
- **Unknown route:** `setNotFoundHandler()` returns the documented 404 shape and request ID.
- **Unexpected application error:** `setErrorHandler()` logs the internal error but returns only a generic 500 code/message and request ID.
- **Malicious request ID:** invalid, oversized, or unexpected characters cause replacement with a UUID, limiting log-injection risk.
- **Secret exposure:** redaction covers authorization/cookie/API-key/token/password/credential/secret fields. Request bodies are excluded by default. New log structures still require security review because no redaction list can replace careful logging design.
- **Provider unavailable or misconfigured:** the smoke test reports a sanitized category. Missing values skip the call and do not affect the application.
- **Native dependency build failure:** the Docker builder has Python, Make, and G++, while the final image excludes that build toolchain.

### 8. Tests

The API tests prove that `buildApp()` does not open a port, health returns HTTP 200 and its exact JSON fields, and an unknown URL returns HTTP 404 with the shared error object and a request ID. The logging test sends sentinel secret values through Pino and asserts that none appear while the redaction marker does.

The production server was separately started from `dist/server.js`, then called over `127.0.0.1:3000`. This proves compiled ESM runs without `tsx`, beyond the in-memory tests.

### 9. Verification results — 2026-11-12

Only observed outcomes are recorded:

| Command/check | Actual outcome |
| --- | --- |
| `node --version` | `v25.6.1` (host; project target is Node 24 LTS) |
| `npm.cmd --version` | `11.9.0` |
| `npm.cmd install` | PASS — 103 packages added, 0 vulnerabilities; lockfile generated. npm warned that host Node 25 is outside the declared Node 24 engine. |
| `npm.cmd ci` | PASS — clean lockfile install added 103 packages and reported 0 vulnerabilities; the same host-engine warning was expected. |
| `npm.cmd run typecheck` | PASS — TypeScript exited 0 with no diagnostics. |
| `npm.cmd test` | PASS — 2 files, 5 tests. |
| `npm.cmd run build` | PASS — production TypeScript compilation exited 0. |
| `node dist/server.js` + `curl /health` | PASS — compiled server listened and returned HTTP 200 with the expected body. |
| `curl /unknown` | PASS — HTTP 404 with `NOT_FOUND`, safe message, and UUID request ID. |
| `npm.cmd run smoke:anthropic` | SKIPPED — `.env` was absent and required variables were not configured; no provider call occurred. |
| Logging redaction | PASS — automated test confirmed representative authorization, API-key, and password values were absent from output. |
| Reference engineering log | ACCESSIBLE — GitHub content was retrieved read-only and used only as a documentation-structure reference. |
| `docker --version` | NOT VERIFIED — Docker command was unavailable; image build and container health were not run. |

An earlier concurrent smoke attempt using `node --import tsx` failed before the script ran because Node 25 on this Windows host returned `ERR_SYSTEM_ERROR`/`uv_os_get_passwd`/`ENOMEM` inside `tsx`. The final command uses Node 24's native TypeScript execution and was rerun successfully to the expected `SKIPPED` state.

### 10. Next phase

Phase 1 should define the `CampaignBrief` schemas, deterministic validation/business rules, explicit error categories, and a small synthetic evaluation dataset. It should not yet grow into a multi-agent architecture. Provider and mock orchestration, tool execution, persistence, approval, UI, and broader evaluations belong to subsequent controlled phases.

Phase 0 stops here pending review.

## Phase 1 — Domain models, business rules, and evaluation

Status: complete locally and awaiting review. Phase 1 adds deterministic campaign-readiness logic only; it does not add an AI agent, provider call, tools, persistence, or an HTTP campaign endpoint.

### 1. What we built

- Runtime Zod schemas for partial and fully validated campaign briefs, objectives, KPI targets, issues, risks, questions, score breakdowns, and decisions.
- Versioned `syntheticRulesConfig` containing every scoring weight, threshold, supported value, objective/KPI mapping, policy reference, prohibited category, and EU country code used at runtime.
- Pure `evaluateReadiness(brief, config, today)` evaluation with an explicit technical success/error result.
- Five concise synthetic policy documents and an exact 100-point rubric.
- A 15-case evaluation dataset with 8 executable domain cases and 7 explicitly deferred integration/security cases.
- Tests for schema behavior, business validation, score boundaries, policy consistency, determinism, and dataset integrity.

### 2. Why the domain layer exists

An LLM is useful for interpreting language, but it should not decide whether a negative budget is valid, whether dates are ordered, or whether an approval rule applies. The domain layer converts validated structured input into repeatable business evidence. A future agent may propose tool arguments, but this layer remains the deterministic authority that accepts, questions, reviews, or blocks them.

Keeping this boundary independent from Fastify and Anthropic also makes it cheap to test. Every result can be reproduced from three inputs: the brief, a rule configuration, and an explicit calendar date.

### 3. TypeScript types versus Zod validation

TypeScript types disappear when JavaScript runs; they protect developers while compiling but cannot prove that JSON from a user, model, or file is safe. Zod schemas execute at runtime. Phase 1 uses both: TypeScript describes contracts inside the codebase, while Zod rejects malformed values at system boundaries and validates the final decision shape.

The evaluator validates fields independently rather than parsing the entire brief as all-or-nothing. This preserves the important distinction between absent data, supplied invalid data, and supplied valid data. A missing budget triggers a question; a supplied negative or non-finite budget triggers a blocker.

### 4. Partial and fully validated briefs

`PartialCampaignBriefSchema` allows required campaign fields to be absent because real briefs are incomplete. It does not coerce invalid supplied values. `ValidatedCampaignBriefSchema` requires the complete structural contract, including a positive finite budget, enumerated objective, structured KPI, channels, dates, country code, and category.

Structural validity is separate from readiness. A structurally complete campaign can still need review because of a high budget or EU privacy trigger, or be blocked by a prohibited category.

### 5. Business status versus technical state

Phase 1 statuses are only `READY`, `NEEDS_REVIEW`, and `BLOCKED`. They describe a campaign business decision. Future execution states such as running, failed, retried, refused, or awaiting a tool response belong to orchestration and are intentionally absent.

### 6. Rubric and precedence

The rubric is defined in `docs/rubric.md` and totals 100:

| Component | Maximum |
| --- | ---: |
| Completeness | 40 |
| Budget validity | 20 |
| Synthetic policy compliance | 25 |
| Measurable objective | 15 |

Status precedence is blocker, missing/invalid critical information, mandatory review, score below 85, then ready. Low score alone never blocks. Tests cover 59, 60, 79, 80, 84, and 85, plus high-score blocker and review overrides.

The policy component gives zero when evidence is unavailable rather than claiming compliance. Completeness and policy deductions may both reflect one invalid field because they answer different questions: whether the brief is complete and whether policy evidence can be established. Deductions inside a policy subcomponent are capped.

### 7. Clarification instead of invention

All fields required by `ValidatedCampaignBrief` are readiness gates: campaign name, objective, audience, country, channels, budget, currency, dates, KPI, and category. This includes—and conservatively extends—the minimum critical set of objective, budget, channels, country, and dates. Missing or invalid required data produces stable structured issues and clarification questions; only `additionalNotes` is optional. Unsupported objectives are never mapped from vague text. Objective/KPI compatibility comes only from the explicit mapping in `rules-config.ts`; no regex or LLM semantic inference is used.

### 8. Pure-function and date design

The evaluator receives `today` as an ISO `YYYY-MM-DD` value. It does not call `Date.now()`, read files, contact services, use a database, or mutate global state. Date-only strings are compared after calendar validation, avoiding local-time and daylight-saving ambiguity. Identical inputs are tested to produce deeply equal results.

### 9. Versioned rules and synthetic policies

Rules version `1.0.0` is the runtime source of truth. Policy Markdown is reviewer-facing context and cannot override the typed configuration. Tests verify every configured policy path exists, score weights total 100, deductions fit their caps, supported-value schemas remain aligned, and the versioned EU list has 27 unique codes including Germany.

The EU leads rule is deliberately conservative: a `leads` objective targeting an EU code creates a `REVIEW_REQUIRED` issue, `requiresHumanReview = true`, and a `PRIVACY_REVIEW_POLICY_V1` reference. It is synthetic review routing—not a legal conclusion about EU campaigns.

### 10. Architecture and data flow

```text
untrusted structured input
        |
        v
field-level Zod parsing ----> structured issues/questions
        |
        v
typed rules + explicit today
        |
        +--> completeness score
        +--> budget score
        +--> policy score and risks
        +--> objective/KPI score
        |
        v
precedence decision --> validated structured result
```

`schemas.ts` owns runtime contracts, `rules-config.ts` owns versioned rules, `readiness.ts` owns pure validation/scoring/decision logic, and `evaluation-dataset.ts` owns fixture contracts. `evals/campaign-cases.json` stores expectations written against the rubric.

### 11. Tests and observed verification

On 2026-11-12, after a clean Phase 1 implementation pass:

| Command/check | Observed result |
| --- | --- |
| `npm run typecheck` | PASS — no diagnostics |
| `npm test` | PASS — 6 files, 63 tests |
| `npm run build` | PASS — production TypeScript compilation completed |
| Objective/KPI compatibility | PASS — valid mappings and invalid pairing covered |
| Germany privacy case | PASS — score 97, `NEEDS_REVIEW`, policy reference present |
| Dataset integrity | PASS — exactly 15 cases: 8 executable, 7 future integration |
| Policy references | PASS — every configured reference resolves to a synthetic document |
| Score boundaries | PASS — exact threshold and precedence cases covered |

An added equal-date boundary test initially exposed an ambiguous date policy. Phase 1 used strict `endDate > startDate`; Phase 1.1 subsequently clarified and implemented equal dates as valid single-day campaigns. No future integration case is counted as an executed Phase 1 pass.

### 12. Decisions, trade-offs, and limitations

- Country normalization only trims and uppercases two-letter codes. A full ISO country registry was avoided to keep Phase 1 focused; format-valid fictitious codes are therefore not rejected.
- Category identifiers are normalized to trimmed lowercase strings. The prohibited list is synthetic and intentionally small.
- Unsupported currencies and channels require review rather than blocking, because the demo policies do not establish them as hard prohibitions.
- A valid high budget keeps its points but requires approval; scoring quality and approval authority are distinct.
- The evaluator accepts structured data only. It does not detect prompt injection, interpret prose, retrieve policy, authorize tools, or persist decisions.
- Node 24 LTS remains the target, while this local verification host runs Node 25.6.1.

### 13. Next phase

Phase 2 should add a provider-neutral structured extraction boundary and a deterministic MockProvider default. It should validate every extracted object through the Phase 1 schemas and rules before considering bounded plan-and-execute orchestration. Live Anthropic calls, tools, retries, traces, and approvals should be introduced only in later scoped steps with explicit tests and cost controls.

Phase 1 stops here pending review.

## Phase 1.1 — Final quality and reliability fixes

Phase 1.1 separates technical evaluator failure from business readiness. `evaluateReadiness()` now returns a discriminated union: valid evaluation returns `{ ok: true, decision }`; invalid `today` returns `{ ok: false, error }` with code `INVALID_EVALUATION_DATE`. The failure branch contains no score, campaign status, or synthetic policy issue. Callers and dataset tests narrow `ok` exhaustively before accessing a decision.

Date ordering now permits `endDate === startDate`. A valid single-day campaign receives all 5 date-policy points and can be `READY`; only `endDate < startDate` is blocked. Past-start review behavior is unchanged, and evaluation case 04 remains `BLOCKED` at 95.

Supported objectives, KPI metrics, channels, and currencies in `syntheticRulesConfig` are derived from Zod enum `.options`, eliminating duplicated static lists without introducing a circular import. The KPI-to-objective mapping remains policy-specific. Tests verify all objective keys and every KPI metric are covered exactly once.

Unsupported-channel feedback now reports unique unsupported names in sorted order. For `search`, `tiktok`, and `sms`, the issue states `Unsupported channels: sms, tiktok.` and instructs the caller to remove or replace those values. No unrelated brief content is included.

The evaluator remains pure: `today` is explicit, fixed fixture dates are unchanged, and there is no clock, network, file, randomness, database, or LLM access. A future application boundary or orchestrator must supply the request date.

Verification used Node 25.6.1. The declared Node 24 runtime was not available and therefore remains unverified. The final quality gate passed with 6 test files and 67 tests, plus successful typecheck and production build. The dataset remains exactly 15 cases: 8 executable and 7 deferred.

Phase 1.1 stops here pending review.

## Phase 2A — Secure, working agent core

Phase 2A adds one bounded provider-neutral agent around the existing deterministic domain engine. It accepts a structured campaign brief plus an explicit `today`; it does not extract data from prose or contact an LLM.

The execution state separates technical statuses (`CREATED`, `PLANNING`, `TOOL_RUNNING`, `WAITING_FOR_CLARIFICATION`, `COMPLETED`, `FAILED`, and `REFUSED`) from the domain statuses (`READY`, `NEEDS_REVIEW`, and `BLOCKED`). Strict Zod actions allow only tool calls, clarification, finish, or refusal. Provider context is cloned, tool inputs are strict empty objects, and registered tools always read the brief, date, and rules from trusted state.

Two tools have deliberately different responsibilities. `checkCampaignFields` projects the existing Phase 1 inspection into missing fields, structurally invalid fields, authoritative issues with severity/code, clarification questions, and a `canEvaluate` routing signal. It does not score or assign business status. `evaluateCampaignReadiness` calls the existing evaluator and is the only source of a business decision. A Phase 1 blocker takes precedence over simultaneous missing-field questions, so a supplied negative budget reaches the evaluator and remains `BLOCKED`.

`MockProvider` is a deterministic simulation of provider decisions, not genuine LLM reasoning. Its first action requests field inspection. It then selects clarification or full evaluation from the actual inspection result, and finishes only after the evaluator returns a decision. The orchestrator independently enforces the finish precondition and creates the final summary from verified decision data.

Reliability controls are intentionally small: maximum planning steps, maximum tool calls, repeated tool-action detection, strict action/argument validation, authorization checks, and safe provider/tool failure handling. Invalid `today` remains a technical `FAILED` result with no business decision or score. No retries, deadline cancellation, persistence, database, UI, approval endpoint, or Anthropic provider was added.

Execution events are stored in memory and contain run/trace IDs, step, event type, tool name where relevant, outcome, and sanitized error code. The compiled `demo-traces` path produces actual complete, incomplete, and controlled-failure traces from synthetic inputs.

Verification on 2026-11-12 used Node 25.6.1, outside the declared Node 24 target. Typecheck passed, all 7 test files and 92 tests passed, and the production build passed. The existing evaluation dataset remains 15 fixtures: 8 executable domain cases and 7 deferred cases. No Anthropic request, dependency installation/update, staging, commit, or push occurred during Phase 2A.

**Not in production today.** Natural-language extraction, a real Claude provider, persistence, advanced retry/deadline behavior, human approval, frontend, and advertising-platform integrations remain future work.

Phase 2A stops here pending review.

## Phase 2B — Focused agent reliability

Phase 2B extends the existing orchestrator rather than replacing it. Provider decisions and registered tool executions now run behind configurable, finite per-operation boundaries. Both default to 5 seconds. The orchestrator passes an `AbortSignal` into compatible providers and tools and accepts an optional caller signal for cooperative cancellation.

Timeout or cancellation ends the orchestrator's wait and produces a structured technical `FAILED` result. It never produces `BLOCKED`, `NEEDS_REVIEW`, a readiness score, or a fabricated decision. Providers already receive cloned context; tools now receive cloned state and rule configuration snapshots. Therefore a promise resolving after timeout cannot update terminal agent state. Promise-level timeout does not physically terminate an implementation that ignores its signal, so external side effects from uncooperative code remain a limitation.

The default retry allowance is one additional attempt. A retry occurs only when the operation explicitly throws `TransientAgentOperationError` and separately declares retry safety: `retrySafe: true` for a provider or `idempotent: true` for a tool. Timeouts and cancellation are not retried because completion may be uncertain. Ordinary failures, invalid provider output, unknown/unauthorized tools, invalid arguments, refusals, clarification paths, and legitimate business decisions are also not retried. Future Anthropic integration must coordinate SDK and orchestrator retry policies so one logical decision does not receive duplicated retry layers.

Existing trace event types were preserved. Provider outcomes plus `TOOL_SUCCEEDED` and `TOOL_FAILED` carry measured `durationMs`; `TOOL_STARTED` carries only its attempt because no elapsed duration exists yet. Failed attempts record a sanitized classification. Timers and external abort listeners are removed when each attempt settles.

Focused tests cover provider timeout, cooperative tool timeout, late tool resolution, caller cancellation, provider and tool transient recovery, retry exhaustion, ordinary non-transient failure, non-idempotent no-retry behavior, validation/unknown-tool no-retry behavior, and unchanged Phase 2A complete, incomplete, and blocked paths.

Verification on 2026-11-12 used Node 25.6.1, outside the declared Node 24 target. Typecheck passed, all 8 test files and 104 tests passed, and the production build passed. No domain scoring or dependency files changed. No Anthropic request, dependency installation/update, staging, commit, or push occurred during Phase 2B.

There is intentionally no overall run deadline, distributed cancellation, worker isolation, persistence, real Claude provider, database, UI, approval endpoint, or advertising integration. **Not in production today.**

Phase 2B stops here pending review.

## Phase 3 — Claude agent and secure policy retrieval

**Decision.** One Claude-driven agent inside the existing orchestrator, not a framework or multi-agent graph: the task is a short, safety-critical pipeline where deterministic code must stay authoritative. Claude proposes the next step; the backend validates, authorizes and decides.

**Protocol.** Six tools (3 business, 3 control) with `tool_choice: any` and parallel tool use disabled. The provider keeps a per-run transcript with matching `tool_use_id`/`tool_result`, committed only after a successful response so orchestrator retries do not corrupt it. Non-`tool_use` stops, multiple tool blocks, and bad control arguments fail safely with no decision. Unknown tool names reach the orchestrator, which rejects them.

**Trust.** Brief and policy text are bounded, escaped data (300-char strings, 20 items, depth 4, 4000 chars). `ask_user` questions come from the trusted field check; `finish` is allowed only after a successful evaluation; `refuse` maps fixed codes to fixed reasons. Regression tests cover injection in `additionalNotes` and in policy text.

**Reliability and cost.** Provider default timeout 25 s via the existing orchestrator option; `maxRetries: 0`; one orchestrator retry for rate-limit/connection/5xx only; 401/400 not retried. `max_tokens` 512. Usage is the sum of what the API reported.

**Policy retrieval.** Root derived from `import.meta.url`, tested after `chdir`; Dockerfile copies `data/`.

**Verification (2026-11-12).** Typecheck and build passed; 10 test files, 138 tests passed (104 earlier + 27 provider + 7 policy). Node 25.6.1, not the Node 24 target. The demo shows the three-tool simulated path and injection resistance.

**Not verified.** Live Anthropic calls (none made), Docker runtime, Node 24. Structured briefs only; no natural-language extraction. **Not in production today.**

Phase 3 stops here pending review.

## Run API, UI and Phase 4 — free-text brief intake

**Decision.** Natural-language input is the main gap between the evaluator and a usable tool, so extraction is added as a separate, narrow step in front of the unchanged agent. It is not part of the decision path: Claude only transcribes explicitly stated fields into a draft brief; validation, scoring and status remain deterministic.

**Safety design.** One forced tool call with an `additionalProperties: false` schema; delimited and escaped untrusted text; the trusted `today` date passed separately; every field re-validated by the domain schema (unknown keys such as `status` or `score` are dropped and reported); bad or ambiguous responses fail with sanitized codes; no retries; abort/timeout propagated. The UI shows the draft for human review before any evaluation. The extractor is told to omit anything not stated; this reduces but cannot eliminate misreads, which is why the review step exists.

**API.** `POST /api/extract` (16 KB limit, 3–4000 characters), `POST /api/runs` (32 KB), `GET /api/config`, `GET /`. Client errors return 4xx with a consistent shape; configuration errors return 503 without secrets.

**Verification (2026-11-12).** Typecheck and build passed; 12 test files, 172 tests passed on Node 22 (author's Linux copy). An end-to-end run on the built server (extract, then run) returned `COMPLETED / READY / 100` using the simulated extractor and provider.

**Not verified.** Live Claude extraction and agent runs (no API call was made), extraction quality on messy real briefs, Docker runtime, Node 24, the UI in multiple browsers. **Not in production today.**

## Phase 5 — Human approval and observability

**Decision.** Persistence and approval sit around the unchanged agent: the agent still ends at a trusted decision, and a separate deterministic rule maps that decision to a handoff state. A model never decides whether something may be handed off.

**Storage.** Node's built-in `node:sqlite` avoids a native dependency (better-sqlite3 has no guaranteed prebuilt binary for every Node version used here). Three tables (runs, run_events, approvals), parameterized statements, foreign keys, one approval row per run enforced by the primary key. If saving fails the decision is still returned, flagged `persisted: false`, and the error is logged without the brief.

**Approval integrity.** The v2 approval hash is SHA-256 over canonical JSON containing a versioned domain separator, the specific `runId`, brief, trusted decision, and derived launch plan. The server compares it with the stored plan at write time and again on every read, so a changed plan invalidates an earlier approval instead of silently carrying it over, and identical plans from different runs cannot share an approval.

**Honest limits.** No authentication: reviewer names are labels. No change-and-resubmit workflow: a corrected brief is a new run with its own hash. `node:sqlite` is experimental. The database is local to the process or volume.

**Verification (2026-11-12).** Typecheck and build passed; 13 test files, 187 tests passed on Node 22 in the author's Linux copy (new: 15 for handoff rule, store, hash and approval API including stale-hash, double-decision, blocked, invalidation and storage-failure cases). Real built server: run → `NEEDS_REVIEW / PENDING_APPROVAL`, approval recorded with the matching hash, file database created.

**Not verified.** Live Claude, Docker runtime (including the `/app/var` volume), Node 24, UI in several browsers. **Not in production today.**

## Phase 6 — Evaluations, fault injection and end-to-end verification

**Decision.** The 15-case dataset existed since Phase 1 but only 8 cases ran, and only against the pure evaluator. Phase 6 invokes the agent for all 15 cases so the claims in earlier phases (injection resistance, controlled failures, approval integrity) are exercised rather than merely asserted. This does not mean that all 15 are complete HTTP end-to-end tests.

**Design.** Cases 01–08 are deterministic business workflows that run twice (mock provider and simulated-Claude provider) and must produce the same trusted result. Cases 09–14 exercise dedicated fault and security scenarios: an obedient extractor and a "skip validation" provider (injection), a temp copy of the policies with an appended malicious paragraph (policy injection), a policy copy with all or one file removed (missing source), a hanging tool (timeout, abort observed), text-only and wrongly shaped provider output (malformed), and an unlisted and a registered-but-unauthorized tool (authorization, never executed). Case 15 invokes the agent and then combines its result with approval-integrity checks for a changed plan. The dataset's `executionScope` and `expectedOutcome` values for cases 09–15 deliberately preserve their historical Phase 1 classification; an explicit dataset note distinguishes that legacy metadata from current Phase 6 execution. Scenario-specific Phase 6 expectations live in `src/eval`.

**Findings worth recording.** The agent and the pure evaluator intentionally differ on missing or ambiguous fields (clarification versus `NEEDS_REVIEW`); the evaluation encodes the agent-level behavior explicitly. A historical manual mutation check temporarily changed the FINISH guard's error code, caused case 09 to fail, and was then reverted. This was a one-off manual check, not an automated mutation-testing suite.

**Verification (2026-11-12).** `npm run eval`: 15/15 cases passed. Full suite and build results are recorded in the final report below the test count in the README.

**Not verified.** Live Claude behavior, Docker image build and run (no Docker in the authoring environment; a static test only), Node 24, UI in several browsers, load. **Not in production today.**

## Phase 3 closure — deterministic launch plan

**Gap closed.** The roadmap's Phase 3 lists `createLaunchPlan` and a human-readable summary; only the summary existed. The plan is built by a pure function from the validated brief and the trusted decision, so the model cannot influence its content. It is also exposed as an optional tool (after evaluation only, no arguments) to match the roadmap, but the API computes it from stored data and does not depend on the model calling it.

**Decisions.** Money is split in integer cents so channel amounts always add up to the total (remainder cents go to the first channels); the split is explicitly an equal-split placeholder because inventing an optimization would be an unverified claim. BLOCKED campaigns get no plan, and an invalid brief gets none (for example an unsupported channel), which the evaluations assert. The approval hash covers the plan, so a future change to the plan format also invalidates old approvals.

**Verification (2026-11-12).** Typecheck and build passed; 16 test files, 205 tests passed on Node 22 in the author's Linux copy (new: plan values, cent-exact split, determinism, NEEDS_REVIEW checklist, BLOCKED/invalid-brief behavior, tool preconditions, tool-limit fit, API fields). The 15-case evaluation also checks the plan expectation per case and passed 15/15.

**Not verified.** Live Claude calling this tool, Docker runtime, Node 24. **Not in production today.**

## Phase 7 — Documentation and submission

Status: complete for documentation; live Claude, Docker and Node 24 remain unverified.

**What was added.** A rewritten README covering problem statement, scope and non-scope, business cases, architecture and data flow, setup, verification with an explicit verified/not-verified table, example inputs and expected outputs, trade-offs, limitations, next steps and a "Real-world usage" section (Not in production today). Sample inputs live in `examples/briefs`, `examples/free-text` and expected outputs in `examples/expected`. `npm run examples` re-runs them with a fixed evaluation date and fails on any difference; it also checks that the mock and simulated-Claude providers agree on every brief.

**Decisions.** Expected outputs are generated once and then protected by `tests/examples.test.ts`, which also asserts the key outcomes with independent hand-written values, so a wrong generated file cannot silently become the truth. Sample dates are in 2027; the fixed date keeps checks stable.

**Verification (2026-11-12).** 17 test files, 213 tests passed on Node 22 (Linux copy, after the UI and route changes); `npm run eval` 15/15; `npm run examples` all match; build and typecheck passed.

**Live check (2026-11-12, after the entries above).** The author ran `npm run smoke:agent` against real Claude on Windows: PASS, `COMPLETED`, `READY`, score 100, tools `checkCampaignFields` and `evaluateCampaignReadiness`, 3 requests, 6199 input / 55 output tokens. One run only; no other live behavior was exercised.

**UI (2026-11-12, evening).** The tool UI was redesigned (guided three-step flow, form synchronized with an advanced JSON editor, verdict card, launch plan tiles, approval panel, readable trace) and a home page was added at `/`; the tool moved to `/app`. `npm start` now reads `.env` (before, only `smoke:agent` did, so the server silently ran the default mock provider). Both pages load no external resource and use no `innerHTML`; tests assert both. The UI was checked in headless Chromium against canned API responses at desktop, mobile and dark widths, and the data flow was checked against the real server's routes; it was not exercised end to end in a real browser against live Claude. Home page copy describes audiences as illustrative: the product has no customers.

**Not verified.** Live Claude beyond that single smoke run (evaluation cases, injection, free-text extraction), Docker build/run, Node 24, extraction on messy real text, multiple browsers. **Not in production today.**

## Engineering Closure and Hardening Addendum — 2026-11-13

This addendum records corrections completed after the original phase entries. It does not retroactively change what was available or verified in those phases.

### Phase 3 hardening — Anthropic protocol and live-smoke integrity

- The Claude-facing `refuse` tool schema now requires `code`, matching the strict backend Zod schema and its fixed refusal-code mapping. This prevents a schema mismatch from producing an apparently valid but backend-invalid refusal.
- The opt-in live smoke reports PASS only when the provider mode is actually `anthropic`, execution is `COMPLETED`, the final decision passes `CampaignReadinessDecisionSchema`, the fixture is `READY`, the required business tools succeeded, and real request/token usage proves a completed tool-use workflow. It does not silently use `MockProvider` and was not invoked during offline verification.
- Protocol coverage includes a response containing text plus one valid `tool_use` block. The provider safely ignores non-authoritative text and maps the validated tool block; text never becomes a command or decision.
- Tool-use transcript handling preserves matching `tool_use_id`/`tool_result` pairs and commits conversation history only after a successful provider response. Retries therefore do not duplicate or corrupt the trusted transcript.

These changes matter because provider-facing JSON Schema, backend validation, transcript continuity, and smoke-test claims must agree. A connectivity response alone is not proof that the real agent workflow completed correctly.

### Phase 4 hardening — extraction accuracy and cancellation

- Trusted backend validation now enforces field-specific extraction limits: campaign name 120 characters, audience 300, and category 80. Invalid model values are dropped and reported instead of truncated into different data.
- An already-aborted `AbortSignal` is rejected before initiating an Anthropic request. Focused coverage confirms zero provider calls in this condition.
- Ambiguous or yearless campaign dates remain missing for human confirmation; the simulated extractor no longer guesses a year.
- Extraction still produces only a reviewable partial draft. The UI requires the user to review/edit it and explicitly choose **Run agent**; extraction cannot evaluate, approve, or publish a campaign.

These corrections prevent syntactically convenient but semantically invented campaign data from crossing the trusted intake boundary.

### Phase 5 hardening — persisted-data and approval integrity

- SQLite JSON is parsed and validated through runtime Zod schemas before becoming a stored run, event, or approval. Corrupt JSON and schema-invalid records are rejected and cannot derive `CLEARED` or approval eligibility.
- Approval hashes were upgraded to v2: SHA-256 covers a versioned domain separator, `runId`, brief, trusted decision, and derived launch plan. Identical campaign content in separate runs therefore receives different hashes, and legacy unbound hashes fail safely.
- Approval insertion relies on the one-row-per-run database constraint and atomic result handling, so only one concurrent approval attempt succeeds.
- Handoff derivation recomputes the current v2 hash on reads and writes. A real change to persisted brief/decision/plan data yields `APPROVAL_INVALIDATED`.
- When a run cannot be persisted, the API returns `persisted: false`, the UI explains that approval/history are unavailable, and approval controls are not rendered. The records API has no run to approve.

These changes matter because approval is a security decision over exact persisted evidence, not a reusable label attached to similar content.

### Phase 6 hardening — evaluation claim accuracy

- The Phase 6 runner invokes the agent for all 15 cases. Cases 01–08 are deterministic business workflows under mock and simulated-Claude providers. Cases 09–14 exercise prompt/policy injection, missing policy, timeout, malformed provider output, and unauthorized-tool boundaries. Case 15 invokes the agent and combines its result with approval-integrity checks.
- Cases 09–15 deliberately retain their historical Phase 1 `FUTURE_INTEGRATION_CASE` and `NOT_EXECUTED` metadata. An explicit note in `evals/campaign-cases.json` distinguishes that legacy classification from current Phase 6 execution.
- Not every case is a complete HTTP end-to-end test. A separate integration test covers free-text extraction, agent execution, approval, and history through the API.
- The recorded FINISH-guard mutation was a historical one-off manual check: changing the expected error caused case 09 to fail and was reverted. It is not an automated mutation-testing framework or suite.

These clarifications preserve the original dataset history while preventing deferred metadata or manual experiments from being misreported as current execution status or automated coverage.

### Phase 7 closure — documentation, examples, UI, and publication

- The README is the concise entry point for setup, provider modes, runnable examples, verification evidence, limitations, and real-world production requirements.
- [docs/SYSTEM_DESIGN.md](./docs/SYSTEM_DESIGN.md) is the deep technical reference. It documents system context, components, state/action contracts, Anthropic protocol, tools, extraction, domain logic, policy trust boundaries, sequences, SQLite, approval, API, security threats, reliability, tracing, evaluations, deployment, ADRs, and confirmed design patterns.
- Six structured briefs execute through both mock and simulated providers; one free-text example runs extraction followed by agent execution. Stored expected outputs are compared with actual results and independently asserted. A mismatch exits nonzero.
- The homepage and guided UI provide editable brief intake, explicit extraction and agent actions, readable decisions, launch plans, traces, history, and approval. Dynamic user/server content is rendered as text rather than HTML.
- Final documentation corrections distinguish current verification from historical counts, document the run-bound v2 approval hash accurately, clarify all 15 evaluation paths, and identify the manual mutation experiment honestly.
- Before publication, the exact reviewed file allowlist, staged diff, Git identity, ignore rules, and staged content were checked. `.env`, databases, logs, credentials, dependencies, and build output were excluded. The final publication commit was pushed without force after local, tracking, and GitHub hashes matched.

### Final verified state and remaining limitations

The latest confirmed offline result remains 225/225 tests across 17 files, 15/15 evaluation cases, 7/7 examples, successful typecheck, and successful production build on Node.js 25.6.1. The single documented live Claude smoke proves one real tool-use workflow and its reported usage; it does not establish live extraction quality, adversarial robustness, or broad model reliability.

Node.js 24, a real Docker image/container health check, broad browser compatibility, load behavior, authentication, authorization, tenant isolation, rate limiting, model-cost governance, production secret management, database migration/backup, and real policy/legal validation remain unverified or unimplemented. BullsNexa has no advertising-platform integration and cannot publish campaigns or spend money. **Not in production today.**
