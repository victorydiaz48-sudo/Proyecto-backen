import { LogEvent, NonRetryableError, silentLogger, type Logger } from '@autocontent/shared';
import {
  DEFAULT_RETRY_POLICY,
  backoffDelay,
  type EnqueueOptions,
  type FinalFailureHandler,
  type JobContext,
  type JobHandler,
  type JobQueue,
  type JobState,
  type JobWorker,
  type RetryPolicy,
  type WorkerOptions,
} from './types.js';

interface Pending<P> {
  payload: P;
  jobId: string;
  attempt: number;
}

/**
 * Single-process queue implementing both sides of the contract. Jobs enqueued
 * before a handler is registered wait until `process()` is called.
 */
export class InMemoryQueue<P> implements JobQueue<P>, JobWorker<P> {
  private readonly states = new Map<string, JobState>();
  private readonly inflight = new Set<Promise<void>>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly ready: Pending<P>[] = [];
  private handler?: JobHandler<P>;
  private onFinalFailure?: FinalFailureHandler<P>;
  private concurrency = Infinity;
  private closed = false;

  constructor(
    private readonly opts: {
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

  async enqueue(payload: P, { jobId, delayMs = 0 }: EnqueueOptions) {
    if (this.closed) throw new Error('Queue is closed');
    if (this.states.has(jobId)) return { jobId, duplicate: true };
    this.setState(jobId, 'pending');
    this.schedule({ payload, jobId, attempt: 1 }, delayMs);
    return { jobId, duplicate: false };
  }

  async getState(jobId: string) {
    return this.states.get(jobId);
  }

  process(handler: JobHandler<P>, opts: WorkerOptions<P> = {}) {
    if (this.handler) throw new Error('A handler is already registered');
    this.handler = handler;
    this.onFinalFailure = opts.onFinalFailure;
    this.concurrency = opts.concurrency ?? Infinity;
    this.drain();
  }

  /** Resolves once nothing is running, waiting for a retry, or runnable. */
  async onIdle(): Promise<void> {
    while (this.inflight.size > 0 || this.timers.size > 0 || (this.handler && this.ready.length > 0)) {
      await Promise.race([...this.inflight, new Promise((r) => setTimeout(r, 5))]);
    }
  }

  async close() {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.ready.length = 0;
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

  private schedule(job: Pending<P>, delayMs: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.closed) return;
      this.ready.push(job);
      this.drain();
    }, delayMs);
    this.timers.add(timer);
  }

  private drain() {
    while (this.handler && !this.closed && this.ready.length > 0 && this.inflight.size < this.concurrency) {
      const job = this.ready.shift()!;
      const run = this.run(this.handler, job).finally(() => {
        this.inflight.delete(run);
        this.drain();
      });
      this.inflight.add(run);
    }
  }

  private async run(handler: JobHandler<P>, { payload, jobId, attempt }: Pending<P>) {
    const maxAttempts = this.retry.maxRetries + 1;
    const logger = this.logger.child({ jobId, attempt });
    const ctx: JobContext = { jobId, attempt, maxAttempts, logger };
    this.setState(jobId, 'processing');
    logger.info('job started', { event: LogEvent.JOB_STARTED });
    const started = Date.now();
    try {
      await handler(payload, ctx);
      this.setState(jobId, 'completed');
      logger.info('job completed', { event: LogEvent.JOB_COMPLETED, durationMs: Date.now() - started });
    } catch (err) {
      const retryable = !(err instanceof NonRetryableError);
      if (retryable && attempt < maxAttempts && !this.closed) {
        const delay = backoffDelay(this.retry, attempt);
        this.setState(jobId, 'retrying');
        logger.warn('job attempt failed, retrying', { event: LogEvent.JOB_RETRYING, delayMs: delay, err });
        this.schedule({ payload, jobId, attempt: attempt + 1 }, delay);
        return;
      }
      this.setState(jobId, 'failed');
      logger.error('job failed', { event: LogEvent.JOB_FAILED, retryable, err });
      try {
        await this.onFinalFailure?.(payload, err, ctx);
      } catch (hookErr) {
        logger.error('onFinalFailure handler threw', { err: hookErr });
      }
    }
  }
}
