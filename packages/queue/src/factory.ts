import type { Logger } from '@autocontent/shared';
import { BullMqQueue } from './bullmq.js';
import { InMemoryQueue } from './in-memory.js';
import type { JobQueue, JobWorker, RetryPolicy } from './types.js';

export type Queue<P> = JobQueue<P> & JobWorker<P> & { readonly backend: 'redis' | 'memory' };

/**
 * Picks the queue backend: Redis/BullMQ when REDIS_URL is set, otherwise the
 * in-memory queue (jobs are lost on restart; the caller logs a warning and
 * re-enqueues unfinished jobs from the database at startup).
 */
export function createQueue<P>(
  name: string,
  opts: { redisUrl?: string; retry?: RetryPolicy; logger?: Logger; prefix?: string },
): Queue<P> {
  if (opts.redisUrl) {
    const q = new BullMqQueue<P>(name, { redisUrl: opts.redisUrl, retry: opts.retry, logger: opts.logger, prefix: opts.prefix });
    return Object.assign(q, { backend: 'redis' as const });
  }
  const q = new InMemoryQueue<P>({ retry: opts.retry, logger: opts.logger });
  return Object.assign(q, { backend: 'memory' as const });
}
