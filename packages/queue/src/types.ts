import type { Logger } from '@autocontent/shared';

/**
 * Queue contract, split into a producer side (JobQueue — what the Telegram bot
 * and API use) and a consumer side (JobWorker — what apps/worker uses).
 *
 * Implementations:
 *  - InMemoryQueue (this package): tests and single-process deployments
 *    without Redis. Jobs are lost on restart.
 *  - BullMqQueue (Phase 2): Redis-backed, survives restarts, multi-process.
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
   * Idempotency key. A second enqueue with the same jobId is reported as a
   * duplicate and does not run the job again.
   */
  jobId: string;
  /** Run no earlier than this many ms from now (scheduled publishing). */
  delayMs?: number;
}

export interface JobQueue<P> {
  enqueue(payload: P, opts: EnqueueOptions): Promise<{ jobId: string; duplicate: boolean }>;
  getState(jobId: string): Promise<JobState | undefined>;
  close(): Promise<void>;
}

export interface WorkerOptions<P> {
  /** Max jobs processed in parallel by this worker. */
  concurrency?: number;
  /** Called once, after the last attempt failed or on a non-retryable error. */
  onFinalFailure?: FinalFailureHandler<P>;
}

export interface JobWorker<P> {
  process(handler: JobHandler<P>, opts?: WorkerOptions<P>): void;
  close(): Promise<void>;
}

export interface RetryPolicy {
  /**
   * Retries after the first attempt. Spec: MAX_RETRIES = 3 → up to 4 attempts.
   */
  maxRetries: number;
  /** Delay before retry n (1-based) is baseDelayMs * 2^(n-1): 2s, 4s, 8s. */
  baseDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 2000 };

export function backoffDelay(policy: RetryPolicy, retryNumber: number): number {
  return policy.baseDelayMs * 2 ** (retryNumber - 1);
}
