# BullsNexa — AI-Powered Campaign Intelligence

> BullsNexa is an independent technical-assignment prototype. It is not an official Bulls Vision Group product, and its rules and policy documents are **synthetic demonstration material**, not real business or legal guidance.

**Not in production today.** See [Real-world usage](#real-world-usage).

## Problem statement

Campaign teams receive briefs that are incomplete, inconsistent or non-compliant: a missing objective, a budget that is negative or unusually high, an end date before the start date, a channel nobody supports, a lead campaign aimed at the EU without a privacy review. Catching this by hand before launch is slow and error-prone, and the cost of missing it is wasted spend or a policy breach.

BullsNexa turns a brief — structured or written in plain words — into a **checked, explainable launch-readiness decision** (`READY`, `NEEDS_REVIEW` or `BLOCKED`, with a 0–100 score), a launch plan when one is appropriate, and a full audit trail. When a person must decide, the system stops and asks.

## How it works

```text
free text (optional)                structured brief (JSON)
        |                                   ^
        v                                   |
POST /api/extract  --draft brief-->  person reviews / edits
 (one model tool call,                      |
  every field re-validated)                 v
                                     POST /api/runs
                                            |
                                            v
                 +-------------- bounded agent loop --------------+
                 |  model (Claude) or mock PROPOSES the next step |
                 |        |                                       |
                 |        v   backend validates, authorizes       |
                 |  checkCampaignFields  -> missing/invalid fields |
                 |  searchCampaignPolicies -> cited policy excerpts|
                 |  evaluateCampaignReadiness -> deterministic rules|
                 |  createLaunchPlan -> deterministic plan         |
                 |  ask_user | finish | refuse                     |
                 +-------------------------------------------------+
                                            |
                                            v
         decision + summary + trace  ->  SQLite history
                                            |
                 NEEDS_REVIEW? --yes--> human Approve / Reject
                                        (bound to a plan hash)
```

**The core rule: the model proposes, the backend decides.** Status, score, summary, clarification questions, launch plan and handoff state are computed by deterministic code from validated data. A model can choose *which step comes next*; it cannot set a result, skip evaluation, or change campaign data.

## Scope and non-scope

**In scope**
- One tool-using agent with explicit typed state and bounded execution (max steps, max tool calls, repeated-action detection, per-operation timeouts, one narrow retry).
- Deterministic, versioned readiness rules and a synthetic policy library the agent can search.
- Plain-text intake with human review before evaluation.
- Run history, observable traces, and a human approval step for non-trivial decisions.
- A minimal single-page UI and a small HTTP API.

**Out of scope (not implemented)**
- Publishing to any advertising platform, spending money, or any external side effect.
- Authentication, users, roles, multi-tenancy.
- Real client data, real legal or compliance guidance, real company policies.
- Optimized budget allocation (the channel split is an equal-split placeholder).
- A multi-agent system (see [Trade-offs](#trade-offs-and-decisions)).

## Business cases

1. **Agency brief intake.** Account managers check client briefs before handing them to channel teams; incomplete briefs come back with specific questions instead of failing later.
2. **In-house launch gate.** A growth team applies the same budget, date, channel and privacy rules to every launch and keeps an auditable record of who approved exceptions.
3. **Regulated brand approvals.** High-budget or EU lead-generation campaigns are routed to a named reviewer, and an approval is tied to the exact plan that was reviewed.

## Quick start

Prerequisites: Node.js 24 (the project targets 24 LTS; see [verification status](#verification)) and npm.

```bash
npm ci
npm run build
AGENT_PROVIDER=simulated npm start      # offline, no API key needed
```

On Windows PowerShell:

```powershell
npm ci
npm run build
$env:AGENT_PROVIDER="simulated"
npm start
```

Open <http://127.0.0.1:3000> for the home page and press **Open the app** (or go straight to <http://127.0.0.1:3000/app>). In the app, pick a sample brief (or describe a campaign in your own words and press **Extract fields**), press **Run agent**, inspect the verdict, score breakdown, launch plan and trace, and — for `NEEDS_REVIEW` runs — approve or reject. Recent runs are listed under the form.

### Provider modes

`AGENT_PROVIDER` selects who proposes the next step. Business rules are identical in every mode.

| Mode | What it is | Needs |
| --- | --- | --- |
| `mock` (default) | Deterministic rule-based provider. Not an LLM. | nothing |
| `simulated` | Offline stand-in that speaks the real Anthropic `tool_use` protocol, including matching tool-call ids. Rule-based, **not an LLM**; results are labeled `simulated-claude`. | nothing |
| `anthropic` | Live Claude through the Messages API with tool calling. No silent fallback: missing configuration is a clear 503/startup error. | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |

Copy `.env.example` to `.env` for the live mode. The key is never logged, returned, or sent to the model.

### Docker

```bash
docker build -t bulls-nexa .
docker run --rm -p 3000:3000 -v bullsnexa-data:/app/var bulls-nexa
curl http://127.0.0.1:3000/health
```

**Docker has not been built or run by the author** (no Docker in the authoring environment); only a static test guards the Dockerfile. The image is multi-stage, runs as the non-root `node` user, and writes SQLite to `/app/var`.

## Example inputs and expected outputs

Sample briefs live in [`examples/briefs`](./examples/briefs) with expected outputs in [`examples/expected`](./examples/expected). `npm run examples` re-runs all of them (with a fixed evaluation date, so the outputs do not drift) and fails on any difference. The expected values agree with the independent expectations in `evals/campaign-cases.json`, and the test suite asserts the key outcomes by hand rather than trusting the stored files alone.

| Sample | Expected result |
| --- | --- |
| `01-ready-campaign` | `READY`, score 100, handoff `CLEARED`, launch plan available |
| `02-high-budget-needs-review` | `NEEDS_REVIEW`, 100, risk `HIGH_BUDGET_REVIEW`, handoff `PENDING_APPROVAL` |
| `03-eu-leads-privacy-review` | `NEEDS_REVIEW`, 97, risk `EU_LEADS_PRIVACY_REVIEW` |
| `04-blocked-negative-budget` | `BLOCKED`, 80, risk `INVALID_BUDGET`, handoff `NOT_ELIGIBLE`, no plan |
| `05-incomplete-needs-clarification` | `WAITING_FOR_CLARIFICATION`, no score; asks for objective, country, budget, currency, dates, KPI |
| `06-prompt-injection-in-notes` | injection in `additionalNotes` ignored; `NEEDS_REVIEW` (not `READY`) |
| `free-text/summer-sandals.txt` | extracted into a draft brief, then `READY`, 100 |

Run one yourself (server running, `curl` on bash; PowerShell users can use the UI or `Invoke-RestMethod`):

```bash
curl -s -X POST http://127.0.0.1:3000/api/runs \
  -H 'content-type: application/json' \
  -d "{\"brief\": $(cat examples/briefs/02-high-budget-needs-review.json)}"
```

Abridged real response (`AGENT_PROVIDER=mock`; the full response also carries the whole brief-derived decision, issues, plan checklist, run id and trace ids):

```json
{
  "executionStatus": "COMPLETED",
  "businessStatus": "NEEDS_REVIEW",
  "summary": "Campaign NEEDS_REVIEW: The valid budget exceeds the synthetic human-review threshold.",
  "decision": {
    "score": 100,
    "scoreBreakdown": {
      "completeness": { "score": 40, "maximum": 40 },
      "budget": { "score": 20, "maximum": 20 },
      "policyCompliance": { "score": 25, "maximum": 25 },
      "measurableObjective": { "score": 15, "maximum": 15 },
      "total": 100
    },
    "risks": [{ "code": "HIGH_BUDGET_REVIEW", "level": "MEDIUM", "policyRef": "BUDGET_POLICY_V1" }],
    "requiresHumanReview": true,
    "rulesVersion": "1.0.0"
  },
  "handoff": { "status": "PENDING_APPROVAL", "approvalRequired": true },
  "launchPlan": {
    "schedule": { "startDate": "2027-01-10", "endDate": "2027-02-10", "durationDays": 32 },
    "budget": {
      "total": 150000,
      "dailyBudget": 4687.5,
      "channels": [
        { "channel": "search", "amount": 75000, "sharePercent": 50 },
        { "channel": "social", "amount": 75000, "sharePercent": 50 }
      ]
    }
  },
  "provider": { "mode": "mock" },
  "persisted": true
}
```

The response also lists the trace: `AGENT_STARTED`, then for each tool `ACTION_PROPOSED` → `TOOL_STARTED` → `TOOL_SUCCEEDED` (with `durationMs` and `attempt`), and finally `AGENT_COMPLETED`.

> The sample dates are in 2027. A start date in the past is itself a review trigger, so after those dates pass, live runs of the samples will change; `npm run examples` is unaffected because it uses a fixed date.

## System Design

For a detailed technical overview of BullsNexa's architecture,
agent orchestration, security, data flows, and design decisions,
see [System Design](docs/SYSTEM_DESIGN.md).

## Architecture

| Area | Path | Responsibility |
| --- | --- | --- |
| Domain | `src/domain` | Zod contracts, versioned rules, pure `evaluateReadiness`, pure `createLaunchPlan`. No network, clock, randomness or model. |
| Agent | `src/agent` | Orchestrator loop, tool registry, providers (mock, Anthropic, simulated), policy search, reliability (timeouts, retry), free-text extraction. |
| Approval | `src/approval` | Handoff rule and plan-hash approval integrity. |
| Persistence | `src/persistence` | SQLite (Node's built-in `node:sqlite`): runs, trace events, approvals. |
| HTTP | `src/routes`, `src/app.ts` | Fastify routes, validation, safe error envelope, request ids. |
| UI | `public/index.html` (home), `public/app.html` (tool) | Single files, no framework, no external resources, text-only DOM writes, strict CSP. |
| Evaluation | `src/eval`, `evals`, `examples` | 15-case agent evaluation, fault injection, sample inputs/outputs. |

### Agent design

- **State.** Typed `AgentState` holds the trusted brief, evaluation date, tool results and trace. The model never receives a way to alter it: tool arguments are strict empty schemas (the policy search takes only a short query string), so budgets, dates and campaign data cannot be supplied by the model.
- **Planning.** At each step the provider proposes exactly one action (`CALL_TOOL`, `ASK_USER`, `FINISH`, `REFUSE`). The orchestrator validates it against a strict schema, checks the tool exists and is authorized, runs it with a timeout, and feeds the real result back.
- **Statuses are separate.** Technical execution (`COMPLETED`, `WAITING_FOR_CLARIFICATION`, `FAILED`, `REFUSED`, …) is distinct from the business decision (`READY`, `NEEDS_REVIEW`, `BLOCKED`). A failed run never yields a made-up decision.
- **Ordering rules enforced by code.** `FINISH` is accepted only after a successful evaluation; the launch plan needs an evaluation first; a blocker still goes through evaluation so it is recorded; clarification questions come from the trusted field check, not from the model.
- **Tools.** Four business tools (`checkCampaignFields`, `searchCampaignPolicies`, `evaluateCampaignReadiness`, `createLaunchPlan`) and three control actions (`ask_user`, `finish`, `refuse`). Control actions do not count against the business tool limit (default 4).

### Trust boundaries (prompt hygiene)

- The brief, free text, tool results and policy excerpts are **untrusted data**. They are sent to the model as bounded, escaped JSON between delimiters, never inside instructions, and the system prompt tells the model to ignore instructions found in them.
- Even if a model obeys an injection, the backend still computes every result. This is tested: with an obedient scripted model, injected text cannot change status, skip evaluation, force `FINISH`, or smuggle fields through extraction.
- Policy search reads only the five configured policy files from a root derived from the module location (not the working directory); the model controls only a bounded query string.
- Logs contain identifiers, statuses and timings, never the brief; secrets are redacted.

### Reliability

| Concern | Behavior |
| --- | --- |
| Timeouts | Per operation; 5 s default, 25 s for the live provider, 20 s for extraction. `AbortSignal` is propagated. A late result cannot change a finished run. |
| Retries | One, only for explicitly transient failures (rate limit, connection, 5xx) on retry-safe providers or idempotent tools. Auth and invalid-request errors are never retried. SDK retries are disabled so counts do not multiply. |
| Limits | Maximum planning steps and tool calls, repeated-action protection. |
| Bad model output | Text without a tool call, extra or wrong fields, unknown or unauthorized tools, multiple tool calls: controlled failure, no decision. |
| Storage failure | The decision is still returned, flagged `persisted: false`. |
| Cost | `max_tokens` 512 (agent) / 700 (extraction); actual token usage from the API is summed per run and never estimated. Offline modes report none. |

## Approval and observability

- Every run is stored: brief, decision, per-step trace with latency and attempt number, token usage (live mode only), total duration. `GET /api/runs` and `GET /api/runs/:id` expose them.
- Handoff is a deterministic rule: `BLOCKED` → `NOT_ELIGIBLE` (cannot be approved); `NEEDS_REVIEW` or evaluator-flagged → `PENDING_APPROVAL`; otherwise `CLEARED`.
- An approval must carry the SHA-256 `planHash` of the brief, decision and launch plan the reviewer saw. A stale hash is rejected, a second decision is rejected, and an approval stops counting (`APPROVAL_INVALIDATED`) if the stored plan no longer matches.
- **There is no authentication**: the reviewer name is a free-text label, not an audit-grade identity.

## API

| Method and path | Purpose |
| --- | --- |
| `GET /` | Home page. |
| `GET /app` | The working tool (single-page UI). |
| `GET /health` | Liveness. |
| `GET /api/config` | Provider mode and the evaluation date in use. |
| `POST /api/extract` `{ text }` | Free text → draft brief, field lists, notice to review. |
| `POST /api/runs` `{ brief }` | Run the agent; returns decision, summary, trace, handoff, launch plan, plan hash. |
| `GET /api/runs` | Last 20 runs. |
| `GET /api/runs/:id` | One run with trace, plan and approval. |
| `POST /api/runs/:id/approval` | `{ decision, reviewer, comment?, planHash }`. |
| `DELETE /api/runs/:id` | Remove a run with its trace and approval (204, or 404). The demo has no authentication. |
| `GET /images/:name` | Decorative photos from a fixed allowlist (same-origin). |

Errors share one envelope, `{ "error": { "code", "message" }, "requestId" }`, with 400 (invalid input), 404, 409 (approval conflicts), 413 (body too large), 503 (live provider not configured) and 504/502 (extraction timeout/provider error). Body limits: 32 KB runs, 16 KB extract, 4 KB approval.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_PROVIDER` | `mock` | `mock`, `simulated` or `anthropic`. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | – | Required only for `anthropic`. `.env.example` suggests `claude-haiku-5-5`. |
| `DATABASE_PATH` | `var/bullsnexa.sqlite` | SQLite file (git-ignored). |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Listen address. |

## Verification

```bash
npm run typecheck     # strict TypeScript
npm test              # unit, integration and end-to-end tests (offline)
npm run build
npm run eval          # 15 evaluation cases through the real agent, offline
npm run examples      # sample inputs vs expected outputs
npm run demo:agent    # printed traces: mock, simulated Claude, failure, injection
```

The Phase 6 runner invokes the agent for all 15 dataset cases. Cases 01–08 are deterministic business workflows, cases 09–14 exercise dedicated fault and security scenarios, and case 15 combines agent execution with approval-integrity checks. The `executionScope` and `expectedOutcome` values for cases 09–15 remain historical Phase 1 metadata, when those cases were deferred; they do not describe their current Phase 6 execution status. Not all 15 cases are complete HTTP end-to-end tests—the separate end-to-end test covers free-text extraction, agent execution, approval, and history through the HTTP API.

All tests are offline and deterministic (explicit dates, scripted or simulated providers). What they cover: domain rules and score boundaries; the agent loop, strict action validation, authorization, limits, timeouts, cancellation, retries and late-result isolation; the Anthropic tool-use protocol with a scripted client (matching tool-call ids, retries, malformed responses, token accounting); policy retrieval independent of the working directory; free-text extraction; persistence and approval integrity; the HTTP API; the 15-case evaluation (prompt injection in the brief and in policy text, missing policy sources, tool timeout, malformed model output, unauthorized tool, plan changed after approval); an end-to-end flow from free text to approval; and a static check of the Dockerfile.

### Verification status

| Item | Status |
| --- | --- |
| Current verification on Node 25.6.1 (Windows) | Tests: 17 files / 229 passed (run by the author after the final UI and run-deletion changes). Typecheck, build, `eval` 15/15 and `examples` 7/7 passed in the earlier publication verification on Windows, and `eval` 15/15 and `examples` (all match) were re-run after the final changes on Node 22 (Linux). Node 25 is outside the declared `>=24 <25` engine range. |
| Earlier verification on Node 22.23.4 (Linux) | 17 files / 213 tests, `eval` 15/15, and all examples passed before the final reliability fixes. |
| Node 24 LTS (the stated target) | **Not verified.** |
| Live Claude, one smoke run (`AGENT_PROVIDER=anthropic`, `npm run smoke:agent`, 2026-11-12, author's Windows machine) | **PASS.** One run on the sample complete brief: `COMPLETED`, `READY`, score 100, tools `checkCampaignFields` then `evaluateCampaignReadiness`, 3 provider requests, 6199 input / 55 output tokens. This is a single run, not a quality or robustness evaluation; behavior on other briefs, on injection attempts and on live free-text extraction is covered only by the scripted-protocol tests. |
| Extraction quality on messy real text | **Not verified.** Tests use a rule-based simulator and scripted responses. |
| Docker build and run | **Not verified.** |
| UI in multiple browsers | Seen in one browser only. |

Current counts on Node 25.6.1 (Windows): 17 test files, 229 tests passed; `npm run eval` 15/15 and `npm run examples` 7/7 (also re-run on Node 22, Linux, after the last changes). Node 24 remains unverified.

To check live behavior yourself: put a key and model in `.env`, set `AGENT_PROVIDER=anthropic`, run `npm run smoke:agent` (one short run; prints status, tools and token usage only, never the key).

## Trade-offs and decisions

- **One agent, not a multi-agent system.** The task is a short, safety-critical pipeline where deterministic code must stay authoritative. Splitting it across agents would add coordination failure modes without adding capability. The tool registry, typed state and provider interface are the seams where further agents could be added (for example a separate review-summarizer), but nothing here pretends to be multi-agent.
- **No agent framework.** A small bounded loop is easier to test, bound and explain than a graph runtime for four tools; the provider interface keeps the model swappable.
- **LLM at the edges only.** Claude chooses the next step and (optionally) drafts a brief from text. It never produces the decision. This costs flexibility and buys auditability.
- **Human review of extraction.** Misreading free text is the highest-risk model step, so a person confirms the draft before anything is evaluated, and the evaluator re-checks every field.
- **`node:sqlite` instead of a native package.** No build toolchain or prebuilt-binary risk; the cost is that the module is still marked experimental and prints a warning.
- **Simulated providers.** They make the whole product demoable and testable offline, and are labeled everywhere so they cannot be mistaken for a model.
- **Equal-split budget placeholder.** An optimized split would be an unverified claim, so the plan says plainly that it is a placeholder.
- **Synthetic rules.** Thresholds and policies are demonstration values in versioned config, not business advice.

## Limitations

- Live Claude was verified with one smoke run only; Docker and Node 24 are unverified (see above).
- No authentication or authorization; approvals are not audit-grade.
- The country check validates the alpha-2 format only; it does not ship a full country registry.
- The offline extractor understands simple English and ISO dates only.
- No overall run deadline; an operation that ignores `AbortSignal` is abandoned, not physically stopped.
- SQLite data is local to the process or volume; there is no migration tooling, retention policy or backup.
- No rate limiting on the HTTP API.
- The launch plan is a synthetic hand-off document; nothing is sent to any platform.

## Next steps

1. Run the evaluation cases and live free-text extraction against real Claude and measure token cost and latency across them (only one smoke run exists so far).
2. Authentication, roles and per-user approval authority.
3. Evaluate extraction on real, messy briefs, including non-English text.
4. Exportable reports and a change-and-resubmit flow for corrected briefs.
5. Metrics and alerting around run outcomes, latency and token usage.
6. A managed database, migrations and a retention policy.

## Real-world usage

**Not in production today.** BullsNexa has not been used with any business or real client data.

Realistic users:
- **A marketing or performance agency** checking client briefs before channel handoff.
- **An in-house growth team** standardizing launch gates and keeping an approval record.
- **A regulated brand** (finance, health, EU-facing lead generation) that needs documented review of high-risk campaigns.

What productionizing would require:
- **Security:** authentication, authorization and tenant isolation; secret management; rate limiting; dependency and prompt-injection review against real data.
- **Data access:** real campaign and policy sources with access control instead of synthetic files, and a decision on what may be sent to a model provider.
- **Monitoring:** metrics, alerting and cost tracking on top of the existing traces; model and rules evaluation on an ongoing basis.
- **Human-in-the-loop:** verified reviewer identity, escalation paths and an immutable audit log.
- **Compliance:** legal review of the real policies encoded as rules, data retention and privacy obligations, and sign-off before any automated action reaches an ad platform.

## Repository layout

```text
src/domain        rules, schemas, evaluator, launch plan
src/agent         orchestrator, tools, providers, extraction, policy search
src/approval      handoff and plan-hash integrity
src/persistence   SQLite run store
src/routes        HTTP routes
src/eval          15-case agent evaluation
src/examples      example runner
public            home page (index.html) and tool UI (app.html)
data/synthetic-policies   five synthetic policy documents
evals             evaluation dataset
examples          sample inputs and expected outputs
tests             all tests (offline)
docs/rubric.md    exact scoring rubric
ENGINEERING_LOG.md   phase-by-phase record of decisions and verification
```

See [ENGINEERING_LOG.md](./ENGINEERING_LOG.md) for the chronological build record and [docs/rubric.md](./docs/rubric.md) for the scoring rules. The log is historical: statements in earlier phases describe the project at that time.
