# BullsNexa Engineering Log

Incremental build diary for BullsNexa. This log records what exists, why it exists, and how it was actually verified. Its phase-oriented, evidence-first structure was informed by the read-only [PILOT AI engineering log](https://github.com/sara-2-ai-ml/pilot-flight-agent/blob/main/ENGINEERING_LOG.md); no PILOT code was copied or modified.

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
