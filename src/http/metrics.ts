export interface HttpMetricRow {
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly count: number;
}

/**
 * Minimal in-process request counters. Labels are the HTTP method, the route
 * TEMPLATE (never the raw URL, so ids and query strings cannot grow the label
 * set) and the status code. Nothing about a campaign brief is recorded.
 */
export class HttpMetrics {
  private readonly counts = new Map<string, number>();
  private rateLimited = 0;
  private readonly startedAt = Date.now();

  record(method: string, route: string, status: number): void {
    const key = `${method}\u0000${route}\u0000${status}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  recordRateLimited(): void {
    this.rateLimited += 1;
  }

  snapshot(): {
    uptimeSeconds: number;
    rateLimitedRequests: number;
    requests: HttpMetricRow[];
  } {
    const requests: HttpMetricRow[] = [...this.counts.entries()]
      .map(([key, count]) => {
        const [method = "", route = "", status = "0"] = key.split("\u0000");
        return { method, route, status: Number(status), count };
      })
      .sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method) || a.status - b.status);
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      rateLimitedRequests: this.rateLimited,
      requests,
    };
  }
}
