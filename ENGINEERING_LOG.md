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
