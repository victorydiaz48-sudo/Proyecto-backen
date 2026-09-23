/**
 * Cuenta fallos por clave (p. ej. tenant+email) en una ventana deslizante y bloquea al superar el
 * máximo. En memoria: válido con una sola instancia; con varias, mover a Redis (docs/SECURITY.md).
 */
export class FailureLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  fail(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.failures.set(key, list);
    if (this.failures.size > 10_000) this.prune();
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    return (this.failures.get(key) ?? []).filter((t) => t > since);
  }

  private prune(): void {
    for (const key of this.failures.keys()) {
      if (this.recent(key).length === 0) this.failures.delete(key);
    }
  }
}
