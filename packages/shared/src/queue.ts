import { NonRetryableError } from './errors.js';
import type { Logger } from './logger.js';
import { LogEvent, silentLogger } from './logger.js';

/**
 * Job queue contract. Phase 0 ships an in-memory implementation; Phase 2 adds
 * a Redis/BullMQ implementation of this same interface, so producers (the
 * Telegram bot) and handlers do not change.
 */
export type JobState = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';

export interface JobContext {
  jobId: string;
  /** 1-based attempt number */
  attempt: number;
  maxAttempts: number;
  logger: Logger;
}

export type JobHandler<P> = (payload: P, ctx: JobContext) => Promise<void>;
export type FinalFailureHandler<P> = (payload: P, err: unknown, ctx: JobContext) => Promise<void>;

export interface EnqueueOptions {
  /**
   * Idempotency key. A second enqueue with the same jobId is ignored while the
   * first is known to the queue, so redelivered webhooks never duplicate work.
   */
  jobId: string;
}

export interface JobQueue<P> {
  enqueue(payload: P, opts: EnqueueOptions): Promise<{ jobId: string; duplicate: boolean }>;
  getState(jobId: string): JobState | undefined;
  close(): Promise<void>;
}

export interface RetryPolicy {
  /** Total attempts including the first one. Spec: MAX_RETRIES = 3 → 3 attempts. */
  maxAttempts: number;
  /** Delay before attempt n+1 is baseDelayMs * 2^(n-1). */
  baseDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 2000 };

export function backoffDelay(policy: RetryPolicy, attempt: number): number {
  return policy.baseDelayMs * 2 ** (attempt - 1);
}

/**
 * Single-process queue. Good enough for the walking skeleton and for tests;
 * jobs are lost on restart, which Phase 2's BullMQ queue fixes.
 */
export class InMemoryJobQueue<P> implements JobQueue<P> {
  private readonly states = new Map<string, JobState>();
  private readonly inflight = new Set<Promise<void>>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private closed = false;

  constructor(
    private readonly handler: JobHandler<P>,
    private readonly opts: {
      onFinalFailure?: FinalFailureHandler<P>;
      retry?: RetryPolicy;
      logger?: Logger;
      /** Cap on remembered job ids for dedupe. */
      maxTracked?: number;
    } = {},
  ) {}

  private get retry() {
    return this.opts.retry ?? DEFAULT_RETRY_POLICY;
  }

  private get logger() {
    return this.opts.logger ?? silentLogger;
  }

  async enqueue(payload: P, { jobId }: EnqueueOptions) {
    if (this.closed) throw new Error('Queue is closed');
    if (this.states.has(jobId)) return { jobId, duplicate: true };
    this.setState(jobId, 'pending');
    this.schedule(payload, jobId, 1, 0);
    return { jobId, duplicate: false };
  }

  getState(jobId: string) {
    return this.states.get(jobId);
  }

  /** Resolves once no job is running or waiting for a retry. */
  async onIdle(): Promise<void> {
    while (this.inflight.size > 0 || this.timers.size > 0) {
      await Promise.race([...this.inflight, new Promise((r) => setTimeout(r, 5))]);
    }
  }

  async close() {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    await Promise.allSettled([...this.inflight]);
  }

  private setState(jobId: string, state: JobState) {
    this.states.delete(jobId);
    this.states.set(jobId, state);
    const max = this.opts.maxTracked ?? 10_000;
    while (this.states.size > max) {
      const oldest = this.states.keys().next().value;
      if (oldest === undefined) break;
      this.states.delete(oldest);
    }
  }

  private schedule(payload: P, jobId: string, attempt: number, delayMs: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.closed) return;
      const run = this.run(payload, jobId, attempt).finally(() => this.inflight.delete(run));
      this.inflight.add(run);
    }, delayMs);
    this.timers.add(timer);
  }

  private async run(payload: P, jobId: string, attempt: number) {
    const { maxAttempts } = this.retry;
    const logger = this.logger.child({ jobId, attempt });
    const ctx: JobContext = { jobId, attempt, maxAttempts, logger };
    this.setState(jobId, 'processing');
    logger.info('job started', { event: LogEvent.JOB_STARTED });
    const started = Date.now();
    try {
      await this.handler(payload, ctx);
      this.setState(jobId, 'completed');
      logger.info('job completed', { event: LogEvent.JOB_COMPLETED, durationMs: Date.now() - started });
    } catch (err) {
      const retryable = !(err instanceof NonRetryableError);
      if (retryable && attempt < maxAttempts && !this.closed) {
        const delay = backoffDelay(this.retry, attempt);
        this.setState(jobId, 'retrying');
        logger.warn('job attempt failed, retrying', { event: LogEvent.JOB_RETRYING, delayMs: delay, err });
        this.schedule(payload, jobId, attempt + 1, delay);
        return;
      }
      this.setState(jobId, 'failed');
      logger.error('job failed', { event: LogEvent.JOB_FAILED, retryable, err });
      try {
        await this.opts.onFinalFailure?.(payload, err, ctx);
      } catch (hookErr) {
        logger.error('onFinalFailure handler threw', { err: hookErr });
      }
    }
  }
}
