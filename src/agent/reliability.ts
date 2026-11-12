const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

export const DEFAULT_PROVIDER_TIMEOUT_MS = 5_000;
export const DEFAULT_TOOL_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_RETRIES = 1;

export class TransientAgentOperationError extends Error {
  readonly code: string;
  readonly transient = true;

  constructor(code: string, message = "Transient operation failure") {
    super(message);
    this.name = "TransientAgentOperationError";
    this.code = SAFE_ERROR_CODE.test(code) ? code : "TRANSIENT_OPERATION_FAILURE";
  }
}

export class OperationAttemptFailure extends Error {
  readonly code: string;
  readonly transient: boolean;
  readonly durationMs: number;
  readonly boundary: "timeout" | "cancellation" | undefined;

  constructor(options: {
    code: string;
    transient: boolean;
    durationMs: number;
    boundary?: "timeout" | "cancellation";
  }) {
    super(options.code);
    this.name = "OperationAttemptFailure";
    this.code = options.code;
    this.transient = options.transient;
    this.durationMs = options.durationMs;
    this.boundary = options.boundary;
  }
}

interface OperationAttemptOptions<T> {
  readonly operation: (signal: AbortSignal) => Promise<T>;
  readonly timeoutMs: number;
  readonly externalSignal?: AbortSignal;
  readonly timeoutCode: string;
  readonly cancellationCode: string;
  readonly failureCode: string;
}

export interface OperationAttemptSuccess<T> {
  readonly value: T;
  readonly durationMs: number;
}

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

export async function runOperationAttempt<T>(
  options: OperationAttemptOptions<T>,
): Promise<OperationAttemptSuccess<T>> {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = options.externalSignal?.aborted ?? false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let removeExternalListener: (() => void) | undefined;

  const boundary = new Promise<never>((_resolve, reject) => {
    const rejectCancellation = (): void => {
      cancelled = true;
      controller.abort(options.externalSignal?.reason);
      reject(
        new OperationAttemptFailure({
          code: options.cancellationCode,
          transient: false,
          durationMs: elapsed(startedAt),
          boundary: "cancellation",
        }),
      );
    };

    if (options.externalSignal?.aborted) {
      rejectCancellation();
      return;
    }

    if (options.externalSignal) {
      options.externalSignal.addEventListener("abort", rejectCancellation, {
        once: true,
      });
      removeExternalListener = () =>
        options.externalSignal?.removeEventListener("abort", rejectCancellation);
    }

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(options.timeoutCode));
      reject(
        new OperationAttemptFailure({
          code: options.timeoutCode,
          transient: false,
          durationMs: elapsed(startedAt),
          boundary: "timeout",
        }),
      );
    }, options.timeoutMs);
  });

  const operation = Promise.resolve().then(() =>
    options.operation(controller.signal),
  );

  try {
    const value = await Promise.race([operation, boundary]);
    return { value, durationMs: elapsed(startedAt) };
  } catch (error) {
    if (timedOut) {
      throw new OperationAttemptFailure({
        code: options.timeoutCode,
        transient: false,
        durationMs: elapsed(startedAt),
        boundary: "timeout",
      });
    }
    if (cancelled || options.externalSignal?.aborted) {
      throw new OperationAttemptFailure({
        code: options.cancellationCode,
        transient: false,
        durationMs: elapsed(startedAt),
        boundary: "cancellation",
      });
    }
    if (error instanceof OperationAttemptFailure) throw error;
    if (error instanceof TransientAgentOperationError) {
      throw new OperationAttemptFailure({
        code: error.code,
        transient: true,
        durationMs: elapsed(startedAt),
      });
    }
    throw new OperationAttemptFailure({
      code: options.failureCode,
      transient: false,
      durationMs: elapsed(startedAt),
    });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    removeExternalListener?.();
  }
}
