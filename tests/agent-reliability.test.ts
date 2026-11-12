import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MockProvider,
  TransientAgentOperationError,
  runCampaignAgent,
  type AgentAction,
  type AgentProvider,
  type AgentState,
} from "../src/agent/index.js";
import {
  CHECK_CAMPAIGN_FIELDS,
  createDefaultToolRegistry,
  type ToolExecutionContext,
} from "../src/agent/tools.js";

const TODAY = "2026-01-15";
const completeBrief = {
  campaignName: "Reliability Campaign",
  objective: "sales",
  targetAudience: "Synthetic customers",
  targetCountry: "US",
  channels: ["search"],
  budgetAmount: 25_000,
  currency: "USD",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  targetKpi: { metric: "purchases", targetValue: 500 },
  category: "retail",
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("per-operation timeouts and cancellation", () => {
  it("fails a timed-out provider once and propagates cancellation", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let aborted = false;
    const provider: AgentProvider = {
      retrySafe: true,
      async decideNextAction(_context, signal): Promise<AgentAction> {
        calls += 1;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
      },
    };

    const pending = runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider,
      providerTimeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;

    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("PROVIDER_TIMEOUT");
    expect(calls).toBe(1);
    expect(aborted).toBe(true);
    expect(result.executionHistory).toContainEqual(
      expect.objectContaining({
        eventType: "ACTION_PROPOSED",
        outcome: "timed_out",
        attempt: 1,
        durationMs: 50,
        errorCode: "PROVIDER_TIMEOUT",
      }),
    );
  });

  it("fails a timed-out tool once and aborts a cooperative handler", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let aborted = false;
    const registry = new Map(createDefaultToolRegistry());
    const checkTool = registry.get(CHECK_CAMPAIGN_FIELDS);
    if (!checkTool) throw new Error("Missing check tool");
    registry.set(CHECK_CAMPAIGN_FIELDS, {
      ...checkTool,
      async execute({ signal }): Promise<never> {
        calls += 1;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
      },
    });

    const pending = runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
      toolRegistry: registry,
      toolTimeoutMs: 40,
    });
    await vi.advanceTimersByTimeAsync(40);
    const result = await pending;

    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("TOOL_TIMEOUT");
    expect(calls).toBe(1);
    expect(aborted).toBe(true);
    expect(result.finalDecision).toBeUndefined();
  });

  it("ignores a late tool result and state mutation after timeout", async () => {
    vi.useFakeTimers();
    const registry = new Map(createDefaultToolRegistry());
    const checkTool = registry.get(CHECK_CAMPAIGN_FIELDS);
    if (!checkTool) throw new Error("Missing check tool");
    registry.set(CHECK_CAMPAIGN_FIELDS, {
      ...checkTool,
      async execute({ state }): Promise<{ late: true }> {
        return new Promise((resolve) => {
          setTimeout(() => {
            (state as AgentState).executionStatus = "COMPLETED";
            resolve({ late: true });
          }, 100);
        });
      },
    });

    const pending = runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
      toolRegistry: registry,
      toolTimeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("TOOL_TIMEOUT");
    expect(result.toolResults).toContainEqual(
      expect.objectContaining({ success: false }),
    );

    await vi.advanceTimersByTimeAsync(90);
    expect(result.executionStatus).toBe("FAILED");
    expect(result.finalDecision).toBeUndefined();
    expect(result.toolResults).not.toContainEqual(
      expect.objectContaining({ output: { late: true } }),
    );
  });

  it("supports caller cancellation without converting it to business status", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const provider: AgentProvider = {
      retrySafe: true,
      async decideNextAction(_context, signal): Promise<AgentAction> {
        receivedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), {
            once: true,
          });
        });
      },
    };
    const pending = runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider,
      signal: controller.signal,
    });
    controller.abort();
    const result = await pending;

    expect(receivedSignal?.aborted).toBe(true);
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("PROVIDER_CANCELLED");
    expect(result.finalDecision).toBeUndefined();
  });
});

describe("bounded transient retries", () => {
  it("retries a retry-safe transient provider failure and succeeds", async () => {
    const mock = new MockProvider();
    let calls = 0;
    const provider: AgentProvider = {
      retrySafe: true,
      async decideNextAction(context, signal): Promise<AgentAction> {
        calls += 1;
        if (calls === 1) {
          throw new TransientAgentOperationError("SYNTHETIC_UPSTREAM_BUSY");
        }
        return mock.decideNextAction(context, signal);
      },
    };
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider,
    });

    expect(result.executionStatus).toBe("COMPLETED");
    expect(result.finalDecision?.status).toBe("READY");
    expect(calls).toBe(4);
    expect(result.executionHistory).toContainEqual(
      expect.objectContaining({
        eventType: "ACTION_PROPOSED",
        outcome: "failed",
        attempt: 1,
        errorCode: "SYNTHETIC_UPSTREAM_BUSY",
      }),
    );
    expect(result.executionHistory).toContainEqual(
      expect.objectContaining({
        eventType: "ACTION_PROPOSED",
        outcome: "CALL_TOOL",
        attempt: 2,
      }),
    );
  });

  it("retries an idempotent transient tool failure and succeeds", async () => {
    let calls = 0;
    const registry = new Map(createDefaultToolRegistry());
    const checkTool = registry.get(CHECK_CAMPAIGN_FIELDS);
    if (!checkTool) throw new Error("Missing check tool");
    registry.set(CHECK_CAMPAIGN_FIELDS, {
      ...checkTool,
      async execute(context: ToolExecutionContext): Promise<unknown> {
        calls += 1;
        if (calls === 1) {
          throw new TransientAgentOperationError("SYNTHETIC_TOOL_BUSY");
        }
        return checkTool.execute(context);
      },
    });
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
      toolRegistry: registry,
    });

    expect(result.executionStatus).toBe("COMPLETED");
    expect(calls).toBe(2);
    expect(
      result.executionHistory.filter(
        (event) =>
          event.eventType === "TOOL_FAILED" &&
          event.toolName === CHECK_CAMPAIGN_FIELDS,
      ),
    ).toContainEqual(
      expect.objectContaining({ attempt: 1, errorCode: "SYNTHETIC_TOOL_BUSY" }),
    );
    expect(result.executionHistory).toContainEqual(
      expect.objectContaining({
        eventType: "TOOL_SUCCEEDED",
        toolName: CHECK_CAMPAIGN_FIELDS,
        attempt: 2,
      }),
    );
  });

  it("fails after the single default retry is exhausted", async () => {
    let calls = 0;
    const provider: AgentProvider = {
      retrySafe: true,
      async decideNextAction(): Promise<AgentAction> {
        calls += 1;
        throw new TransientAgentOperationError("SYNTHETIC_PROVIDER_BUSY");
      },
    };
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider,
    });

    expect(calls).toBe(2);
    expect(result.executionStatus).toBe("FAILED");
    expect(result.error?.code).toBe("PROVIDER_RETRY_EXHAUSTED");
    expect(
      result.executionHistory
        .filter((event) => event.eventType === "ACTION_PROPOSED")
        .map((event) => event.attempt),
    ).toEqual([1, 2]);
  });

  it("does not retry a non-transient provider failure", async () => {
    let calls = 0;
    const provider: AgentProvider = {
      retrySafe: true,
      async decideNextAction(): Promise<AgentAction> {
        calls += 1;
        throw new Error("ordinary failure");
      },
    };
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider,
    });
    expect(calls).toBe(1);
    expect(result.error?.code).toBe("PROVIDER_FAILURE");
  });

  it("does not retry a transient non-idempotent tool", async () => {
    let calls = 0;
    const registry = new Map(createDefaultToolRegistry());
    const checkTool = registry.get(CHECK_CAMPAIGN_FIELDS);
    if (!checkTool) throw new Error("Missing check tool");
    registry.set(CHECK_CAMPAIGN_FIELDS, {
      ...checkTool,
      idempotent: false,
      async execute(): Promise<never> {
        calls += 1;
        throw new TransientAgentOperationError("UNCERTAIN_SIDE_EFFECT");
      },
    });
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
      toolRegistry: registry,
    });
    expect(calls).toBe(1);
    expect(result.error?.code).toBe("TOOL_TRANSIENT_FAILURE_NOT_RETRIED");
  });

  it.each([
    {
      name: "unknown tool",
      action: { type: "CALL_TOOL", toolName: "unknown", arguments: {} },
      code: "UNKNOWN_TOOL",
    },
    {
      name: "invalid arguments",
      action: {
        type: "CALL_TOOL",
        toolName: CHECK_CAMPAIGN_FIELDS,
        arguments: { brief: completeBrief },
      },
      code: "INVALID_TOOL_ARGUMENTS",
    },
  ])("never retries $name", async ({ action, code }) => {
    let providerCalls = 0;
    const provider: AgentProvider = {
      retrySafe: true,
      async decideNextAction(): Promise<AgentAction> {
        providerCalls += 1;
        return action as AgentAction;
      },
    };
    const result = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider,
      maxRetries: 5,
    });
    expect(providerCalls).toBe(1);
    expect(result.error?.code).toBe(code);
    expect(
      result.executionHistory.filter(
        (event) => event.eventType === "TOOL_STARTED",
      ),
    ).toHaveLength(0);
  });
});

describe("Phase 2A behavior under reliability defaults", () => {
  it("preserves complete, incomplete, and BLOCKED campaign paths", async () => {
    const complete = await runCampaignAgent({
      brief: completeBrief,
      today: TODAY,
      provider: new MockProvider(),
    });
    const incomplete = await runCampaignAgent({
      brief: { campaignName: "Draft" },
      today: TODAY,
      provider: new MockProvider(),
    });
    const blocked = await runCampaignAgent({
      brief: { ...completeBrief, budgetAmount: -1 },
      today: TODAY,
      provider: new MockProvider(),
    });

    expect(complete.finalDecision?.status).toBe("READY");
    expect(incomplete.executionStatus).toBe("WAITING_FOR_CLARIFICATION");
    expect(blocked.finalDecision?.status).toBe("BLOCKED");
    expect(
      complete.executionHistory
        .filter((event) => event.eventType === "TOOL_SUCCEEDED")
        .every(
          (event) =>
            event.attempt === 1 && typeof event.durationMs === "number",
        ),
    ).toBe(true);
    expect(
      complete.executionHistory
        .filter((event) => event.eventType === "TOOL_STARTED")
        .every(
          (event) => event.attempt === 1 && event.durationMs === undefined,
        ),
    ).toBe(true);
  });
});
