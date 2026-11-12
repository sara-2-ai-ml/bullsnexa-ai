import { createHash } from "node:crypto";

import { z } from "zod";

import { createLaunchPlan } from "../domain/launch-plan.js";
import type { CampaignReadinessDecision } from "../domain/schemas.js";

export const APPROVAL_HASH_DOMAIN = "bullsnexa:approval-plan:v2";

export type HandoffStatus =
  | "NOT_APPLICABLE"
  | "NOT_ELIGIBLE"
  | "CLEARED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "APPROVAL_INVALIDATED";

export interface ApprovalRecord {
  readonly runId: string;
  readonly decision: "APPROVED" | "REJECTED";
  readonly reviewer: string;
  readonly comment: string | undefined;
  readonly planHash: string;
  readonly createdAt: string;
}

export interface Handoff {
  readonly status: HandoffStatus;
  readonly approvalRequired: boolean;
  readonly reason: string;
}

export const ApprovalRequestSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    reviewer: z.string().trim().min(2).max(80),
    comment: z.string().trim().max(500).optional(),
    planHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Hash of exactly what a reviewer approves: the brief, the trusted decision
 * and the launch plan derived from them (when one exists). An approval only
 * counts while the stored plan still hashes to the value the reviewer saw.
 */
export function computePlanHash(
  runId: string,
  brief: unknown,
  decision: CampaignReadinessDecision,
): string {
  const plan = createLaunchPlan(brief, decision);
  return createHash("sha256")
    .update(
      stableStringify({
        domain: APPROVAL_HASH_DOMAIN,
        runId,
        brief,
        decision,
        launchPlan: plan.ok ? plan.plan : null,
      }),
    )
    .digest("hex");
}

export interface HandoffInput {
  readonly runId: string;
  readonly executionStatus: string;
  readonly brief: unknown;
  readonly decision: CampaignReadinessDecision | undefined;
}

/**
 * Deterministic handoff rule. Models never decide it:
 * - no completed evaluation  -> NOT_APPLICABLE
 * - BLOCKED                  -> NOT_ELIGIBLE (cannot be approved)
 * - NEEDS_REVIEW or the evaluator requires human review -> a person must decide
 * - otherwise                -> CLEARED
 */
export function deriveHandoff(
  run: HandoffInput,
  approval: ApprovalRecord | undefined,
): Handoff {
  const { decision } = run;
  if (run.executionStatus !== "COMPLETED" || !decision) {
    return {
      status: "NOT_APPLICABLE",
      approvalRequired: false,
      reason: "No completed evaluation, so there is nothing to hand off.",
    };
  }
  if (decision.status === "BLOCKED") {
    return {
      status: "NOT_ELIGIBLE",
      approvalRequired: false,
      reason: "A BLOCKED campaign cannot be approved; fix the brief and run again.",
    };
  }
  const needsReview =
    decision.status === "NEEDS_REVIEW" || decision.requiresHumanReview;
  if (!needsReview) {
    return {
      status: "CLEARED",
      approvalRequired: false,
      reason: "READY with no human review required.",
    };
  }
  if (!approval) {
    return {
      status: "PENDING_APPROVAL",
      approvalRequired: true,
      reason: "A person must approve or reject before handoff.",
    };
  }
  if (approval.planHash !== computePlanHash(run.runId, run.brief, decision)) {
    return {
      status: "APPROVAL_INVALIDATED",
      approvalRequired: true,
      reason: "The plan changed after the decision was recorded, so the approval no longer applies.",
    };
  }
  return {
    status: approval.decision,
    approvalRequired: true,
    reason: `Recorded decision by ${approval.reviewer}.`,
  };
}
