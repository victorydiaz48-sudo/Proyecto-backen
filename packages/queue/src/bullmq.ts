import { LogEvent, NonRetryableError, silentLogger, type Logger } from '@autocontent/shared';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  DEFAULT_RETRY_POLICY,
  type EnqueueOptions,
  type JobContext,
  type JobHandler,
  type JobQueue,
  type JobState,
  type JobWorker,
  type RetryPolicy,
  type WorkerOptions,
} from './types.js';

export interface BullMqOptions {
  redisUrl: string;
  retry?: RetryPolicy;
  logger?: Logger;
  /** Key prefix in Redis (lets tests and environments share one Redis). */
  prefix?: string;
}

/**
 * Redis-backed implementation of the queue contract. Jobs survive restarts and
 * can be consumed by several processes.
 *
 *  - enqueue with an existing jobId is reported as a duplicate (BullMQ also
 *    ignores re-adding an existing id)
 *  - retries: attempts = maxRetries + 1, exponential backoff
 *  - NonRetryableError → UnrecoverableError (BullMQ stops retrying)
 *  - the final-failure handler runs inside the processor on the last attempt,
 *    so it is not lost if an event listener misses the "failed" event
 *  - a worker that dies mid-job: BullMQ marks the job stalled and re-runs it;
 *    handlers must be idempotent (ours check the database first)
 */
export class BullMqQueue<P> implements JobQueue<P>, JobWorker<P> {
  private readonly queue: Queue;
  private readonly connections: Redis[] = [];
  private worker?: Worker;

  constructor(
    readonly name: string,
    private readonly opts: BullMqOptions,
  ) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid queue name "${name}"`);
    this.queue = new Queue(name, { connection: this.connect(), prefix: opts.prefix });
  }

  private get retry() {
    return this.opts.retry ?? DEFAULT_RETRY_POLICY;
  }

  private get logger() {
    return this.opts.logger ?? silentLogger;
  }

  private connect(): Redis {
    // maxRetriesPerRequest: null is required by BullMQ workers (blocking commands).
    const c = new Redis(this.opts.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
    c.on('error', (err) => this.logger.warn('redis connection error', { err, queue: this.name }));
    this.connections.push(c);
    return c;
  }

  async enqueue(payload: P, { jobId, delayMs = 0 }: EnqueueOptions) {
    if (await this.queue.getJob(jobId)) return { jobId, duplicate: true };
    await this.queue.add(this.name, payload, {
      jobId,
      delay: delayMs,
      attempts: this.retry.maxRetries + 1,
      backoff: { type: 'exponential', delay: this.retry.baseDelayMs },
      // Keep history long enough for dedupe and debugging, but bounded.
      removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
      removeOnFail: { age: 30 * 24 * 3600 },
    });
    return { jobId, duplicate: false };
  }

  async getState(jobId: string): Promise<JobState | undefined> {
    const job = await this.queue.getJob(jobId);
    if (!job) return undefined;
    const s = await job.getState();
    switch (s) {
      case 'active':
        return 'processing';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'delayed':
        return job.attemptsMade > 0 ? 'retrying' : 'pending';
      case 'unknown':
        return undefined;
      default:
        return 'pending'; // waiting, prioritized, waiting-children
    }
  }

  process(handler: JobHandler<P>, opts: WorkerOptions<P> = {}) {
    if (this.worker) throw new Error('A handler is already registered');
    const maxAttempts = this.retry.maxRetries + 1;
    this.worker = new Worker(
      this.name,
      async (job: Job) => {
        const attempt = job.attemptsMade + 1;
        const jobId = job.id!;
        const logger = this.logger.child({ jobId, attempt, queue: this.name });
        const ctx: JobContext = { jobId, attempt, maxAttempts, logger };
        const started = Date.now();
        logger.info('job started', { event: LogEvent.JOB_STARTED });
        try {
          await handler(job.data as P, ctx);
          logger.info('job completed', { event: LogEvent.JOB_COMPLETED, durationMs: Date.now() - started });
        } catch (err) {
          const retryable = !(err instanceof NonRetryableError);
          if (!retryable || attempt >= maxAttempts) {
            logger.error('job failed', { event: LogEvent.JOB_FAILED, retryable, err });
            try {
              await opts.onFinalFailure?.(job.data as P, err, ctx);
            } catch (hookErr) {
              logger.error('onFinalFailure handler threw', { err: hookErr });
            }
            if (!retryable) throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
          } else {
            logger.warn('job attempt failed, retrying', { event: LogEvent.JOB_RETRYING, err });
          }
          throw err;
        }
      },
      { connection: this.connect(), concurrency: opts.concurrency ?? 4, prefix: this.opts.prefix },
    );
    this.worker.on('error', (err) => this.logger.error('worker error', { err, queue: this.name }));
  }

  /** Readiness probe for /ready. */
  async ping(): Promise<boolean> {
    try {
      return (await this.connections[0]!.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
    await Promise.allSettled(this.connections.map((c) => c.quit()));
  }
}
