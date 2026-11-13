import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import type { ApprovalRecord } from "../approval/handoff.js";
import {
  AgentErrorSchema,
  AgentExecutionStatusSchema,
  ExecutionEventSchema,
  type AgentError,
  type ExecutionEvent,
} from "../agent/contracts.js";
import {
  CampaignReadinessDecisionSchema,
  CampaignStatusSchema,
  ClarificationQuestionSchema,
  type CampaignReadinessDecision,
  type ClarificationQuestion,
} from "../domain/schemas.js";

export interface StoredRun {
  readonly runId: string;
  readonly traceId: string;
  readonly createdAt: string;
  readonly providerMode: string;
  readonly executionStatus: string;
  readonly businessStatus: string | undefined;
  readonly score: number | undefined;
  readonly summary: string;
  readonly brief: unknown;
  readonly decision: CampaignReadinessDecision | undefined;
  readonly clarificationQuestions: readonly ClarificationQuestion[];
  readonly error: AgentError | undefined;
  readonly usage: unknown;
  readonly totalDurationMs: number;
  readonly events: readonly ExecutionEvent[];
}

export interface RunStats {
  readonly totalRuns: number;
  readonly byExecutionStatus: Record<string, number>;
  readonly byBusinessStatus: Record<string, number>;
  readonly averageDurationMs: number | null;
  readonly approvals: { readonly approved: number; readonly rejected: number };
}

export interface RunStore {
  saveRun(run: StoredRun): void;
  getRun(runId: string): StoredRun | undefined;
  listRuns(limit: number): readonly StoredRun[];
  getApproval(runId: string): ApprovalRecord | undefined;
  /** Returns false if the run already has a decision. */
  saveApproval(approval: ApprovalRecord): boolean;
  /** Removes a run with its events and any decision. Returns false if it does not exist. */
  deleteRun(runId: string): boolean;
  /** Aggregate counts only; never returns brief content. */
  stats(): RunStats;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  provider_mode TEXT NOT NULL,
  execution_status TEXT NOT NULL,
  business_status TEXT,
  score INTEGER,
  summary TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  decision_json TEXT,
  questions_json TEXT NOT NULL,
  error_json TEXT,
  usage_json TEXT,
  total_duration_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS run_events (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  seq INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS approvals (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  reviewer TEXT NOT NULL,
  comment TEXT,
  plan_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_created_at ON runs(created_at DESC);
`;

type Row = Record<string, unknown>;

export class CorruptedStoredRecordError extends Error {
  readonly code = "CORRUPTED_STORED_RECORD";

  constructor() {
    super("A persisted record failed integrity validation.");
    this.name = "CorruptedStoredRecordError";
  }
}

const ProviderUsageSchema = z
  .object({
    requests: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  })
  .strict();

const StoredRunSchema = z
  .object({
    runId: z.string().uuid(),
    traceId: z.string().uuid(),
    createdAt: z.iso.datetime(),
    providerMode: z.string().min(1),
    executionStatus: AgentExecutionStatusSchema,
    businessStatus: CampaignStatusSchema.optional(),
    score: z.number().int().min(0).max(100).optional(),
    summary: z.string().min(1),
    brief: z.record(z.string(), z.unknown()),
    decision: CampaignReadinessDecisionSchema.optional(),
    clarificationQuestions: z.array(ClarificationQuestionSchema),
    error: AgentErrorSchema.optional(),
    usage: ProviderUsageSchema.optional(),
    totalDurationMs: z.number().int().nonnegative(),
    events: z.array(ExecutionEventSchema),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.decision) {
      if (
        run.executionStatus !== "COMPLETED" ||
        run.businessStatus !== run.decision.status ||
        run.score !== run.decision.score
      ) {
        context.addIssue({
          code: "custom",
          message: "Stored decision metadata is inconsistent.",
        });
      }
    } else if (run.businessStatus !== undefined || run.score !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Stored business metadata has no authoritative decision.",
      });
    }
    if (
      run.events.some(
        (event) => event.runId !== run.runId || event.traceId !== run.traceId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Stored trace events do not belong to this run.",
      });
    }
  });

const StoredApprovalSchema = z
  .object({
    runId: z.string().uuid(),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reviewer: z.string().trim().min(2).max(80),
    comment: z.string().trim().max(500).optional(),
    planHash: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: z.iso.datetime(),
  })
  .strict();

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new CorruptedStoredRecordError();
  }
}

function toRun(row: Row, events: readonly ExecutionEvent[]): StoredRun {
  const parsed = StoredRunSchema.safeParse({
    runId: row.run_id,
    traceId: row.trace_id,
    createdAt: row.created_at,
    providerMode: row.provider_mode,
    executionStatus: row.execution_status,
    businessStatus: row.business_status === null ? undefined : row.business_status,
    score: row.score === null ? undefined : row.score,
    summary: row.summary,
    brief: parseJson(row.brief_json),
    decision: parseJson(row.decision_json),
    clarificationQuestions: parseJson(row.questions_json),
    error: parseJson(row.error_json),
    usage: parseJson(row.usage_json),
    totalDurationMs: row.total_duration_ms,
    events,
  });
  if (!parsed.success) throw new CorruptedStoredRecordError();
  return {
    ...parsed.data,
    businessStatus: parsed.data.businessStatus,
    score: parsed.data.score,
    decision: parsed.data.decision,
    error: parsed.data.error,
    usage: parsed.data.usage,
  };
}

/**
 * SQLite persistence via Node's built-in `node:sqlite` (no native dependency).
 * Pass ":memory:" for tests. All statements are parameterized.
 */
export function createRunStore(location: string = ":memory:"): RunStore {
  if (location !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(location)), { recursive: true });
  }
  const db = new DatabaseSync(location);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  const insertRun = db.prepare(
    `INSERT INTO runs (run_id, trace_id, created_at, provider_mode, execution_status, business_status, score, summary, brief_json, decision_json, questions_json, error_json, usage_json, total_duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEvent = db.prepare(
    "INSERT INTO run_events (run_id, seq, event_json) VALUES (?, ?, ?)",
  );
  const selectRun = db.prepare("SELECT * FROM runs WHERE run_id = ?");
  const selectEvents = db.prepare(
    "SELECT event_json FROM run_events WHERE run_id = ? ORDER BY seq",
  );
  const selectRecent = db.prepare(
    "SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT ?",
  );
  const selectApproval = db.prepare("SELECT * FROM approvals WHERE run_id = ?");
  const insertApproval = db.prepare(
    "INSERT OR IGNORE INTO approvals (run_id, decision, reviewer, comment, plan_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const deleteApprovalRow = db.prepare("DELETE FROM approvals WHERE run_id = ?");
  const deleteEventRows = db.prepare("DELETE FROM run_events WHERE run_id = ?");
  const deleteRunRow = db.prepare("DELETE FROM runs WHERE run_id = ?");

  const countByExecution = db.prepare(
    "SELECT execution_status AS k, COUNT(*) AS n FROM runs GROUP BY execution_status",
  );
  const countByBusiness = db.prepare(
    "SELECT business_status AS k, COUNT(*) AS n FROM runs WHERE business_status IS NOT NULL GROUP BY business_status",
  );
  const averageDuration = db.prepare("SELECT AVG(total_duration_ms) AS a, COUNT(*) AS n FROM runs");
  const countApprovals = db.prepare("SELECT decision AS k, COUNT(*) AS n FROM approvals GROUP BY decision");

  const eventsFor = (runId: string): ExecutionEvent[] =>
    (selectEvents.all(runId) as Row[]).map((row) => {
      const parsed = ExecutionEventSchema.safeParse(parseJson(row.event_json));
      if (!parsed.success) throw new CorruptedStoredRecordError();
      return parsed.data;
    });

  return {
    saveRun(run) {
      db.exec("BEGIN");
      try {
        insertRun.run(
          run.runId,
          run.traceId,
          run.createdAt,
          run.providerMode,
          run.executionStatus,
          run.businessStatus ?? null,
          run.score ?? null,
          run.summary,
          JSON.stringify(run.brief ?? null),
          run.decision ? JSON.stringify(run.decision) : null,
          JSON.stringify(run.clarificationQuestions),
          run.error ? JSON.stringify(run.error) : null,
          run.usage === undefined ? null : JSON.stringify(run.usage),
          Math.round(run.totalDurationMs),
        );
        run.events.forEach((event, index) =>
          insertEvent.run(run.runId, index, JSON.stringify(event)),
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getRun(runId) {
      const row = selectRun.get(runId) as Row | undefined;
      return row ? toRun(row, eventsFor(runId)) : undefined;
    },
    listRuns(limit) {
      return (selectRecent.all(limit) as Row[]).map((row) => toRun(row, []));
    },
    getApproval(runId) {
      const row = selectApproval.get(runId) as Row | undefined;
      if (!row) return undefined;
      const parsed = StoredApprovalSchema.safeParse({
        runId: row.run_id,
        decision: row.decision,
        reviewer: row.reviewer,
        comment: row.comment === null ? undefined : row.comment,
        planHash: row.plan_hash,
        createdAt: row.created_at,
      });
      if (!parsed.success) throw new CorruptedStoredRecordError();
      return { ...parsed.data, comment: parsed.data.comment };
    },
    saveApproval(approval) {
      const result = insertApproval.run(
        approval.runId,
        approval.decision,
        approval.reviewer,
        approval.comment ?? null,
        approval.planHash,
        approval.createdAt,
      );
      return Number(result.changes) === 1;
    },
    deleteRun(runId) {
      db.exec("BEGIN");
      try {
        deleteApprovalRow.run(runId);
        deleteEventRows.run(runId);
        const result = deleteRunRow.run(runId);
        db.exec("COMMIT");
        return Number(result.changes) === 1;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    stats() {
      const toRecord = (rows: Row[]): Record<string, number> =>
        Object.fromEntries(rows.map((row) => [String(row.k), Number(row.n)]));
      const avg = averageDuration.get() as Row;
      const approvals = toRecord(countApprovals.all() as Row[]);
      return {
        totalRuns: Number(avg.n),
        byExecutionStatus: toRecord(countByExecution.all() as Row[]),
        byBusinessStatus: toRecord(countByBusiness.all() as Row[]),
        averageDurationMs: avg.a === null ? null : Math.round(Number(avg.a)),
        approvals: { approved: approvals.APPROVED ?? 0, rejected: approvals.REJECTED ?? 0 },
      };
    },
    close() {
      db.close();
    },
  };
}
