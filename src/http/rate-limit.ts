export interface RateLimitConfig {
  /** Length of one counting window in milliseconds. */
  readonly windowMs: number;
  /** Maximum counted requests per key in one window. */
  readonly max: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Whole seconds until the window resets (0 when allowed). */
  readonly retryAfterSeconds: number;
}

const MAX_TRACKED_KEYS = 10_000;

/**
 * Fixed-window, in-memory limiter keyed by client address. It protects one
 * process only (no shared store), which is stated as a limitation in the docs.
 * The clock is injectable so tests stay deterministic.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly now: () => number = () => Date.now(),
  ) {}

  check(key: string): RateLimitDecision {
    const now = this.now();
    this.evictIfNeeded(now);
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.config.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= this.config.max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Keeps memory bounded: drop expired windows, then the oldest if still too many. */
  private evictIfNeeded(now: number): void {
    if (this.windows.size < MAX_TRACKED_KEYS) return;
    for (const [key, value] of this.windows) {
      if (value.resetAt <= now) this.windows.delete(key);
    }
    while (this.windows.size >= MAX_TRACKED_KEYS) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}
