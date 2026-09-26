/**
 * Per-key fixed-window limiter (in memory, per process). Protects the database
 * from a single Telegram user flooding the bot. Distributed limits come later.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      this.windows.set(key, { count: 1, resetAt: t + this.windowMs });
      if (this.windows.size > 10_000) this.prune(t);
      return true;
    }
    w.count++;
    return w.count <= this.max;
  }

  private prune(t: number) {
    for (const [k, w] of this.windows) if (w.resetAt <= t) this.windows.delete(k);
  }
}
