import { randomUUID } from 'node:crypto';
import { NonRetryableError } from '@autocontent/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BullMqQueue } from './bullmq.js';

/**
 * Runs against a real Redis (TEST_REDIS_URL). Skipped locally when unset;
 * CI sets REQUIRE_REDIS_TESTS=1 so it can never be skipped silently there.
 */
const url = process.env.TEST_REDIS_URL;
if (!url && process.env.REQUIRE_REDIS_TESTS === '1') throw new Error('REQUIRE_REDIS_TESTS=1 but TEST_REDIS_URL is not set');

const until = async (cond: () => Promise<boolean> | boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for condition');
};

describe.skipIf(!url)('BullMqQueue (real Redis)', () => {
  const open: BullMqQueue<unknown>[] = [];
  const make = <P>() => {
    const q = new BullMqQueue<P>(`test-${randomUUID()}`, { redisUrl: url!, retry: { maxRetries: 3, baseDelayMs: 10 }, prefix: 'test' });
    open.push(q as BullMqQueue<unknown>);
    return q;
  };
  afterEach(async () => {
    await Promise.all(open.splice(0).map((q) => q.close()));
  });

  it('processes a job and reports it completed', async () => {
    const q = make<{ n: number }>();
    const seen: number[] = [];
    q.process(async (p) => {
      seen.push(p.n);
    });
    await q.enqueue({ n: 7 }, { jobId: 'job-1' });
    await until(async () => (await q.getState('job-1')) === 'completed');
    expect(seen).toEqual([7]);
  });

  it('treats a repeated jobId as a duplicate', async () => {
    const q = make<object>();
    expect((await q.enqueue({}, { jobId: 'same' })).duplicate).toBe(false);
    expect((await q.enqueue({}, { jobId: 'same' })).duplicate).toBe(true);
  });

  it('retries with backoff, then calls the final-failure handler exactly once', async () => {
    const q = make<object>();
    const attempts: number[] = [];
    const onFinalFailure = vi.fn(async () => {});
    q.process(
      async (_p, ctx) => {
        attempts.push(ctx.attempt);
        throw new Error('provider down');
      },
      { onFinalFailure },
    );
    await q.enqueue({}, { jobId: 'flaky' });
    await until(async () => (await q.getState('flaky')) === 'failed');
    expect(attempts).toEqual([1, 2, 3, 4]);
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-retryable errors', async () => {
    const q = make<object>();
    const handler = vi.fn(async () => {
      throw new NonRetryableError('bad image');
    });
    const onFinalFailure = vi.fn(async () => {});
    q.process(handler, { onFinalFailure });
    await q.enqueue({}, { jobId: 'bad' });
    await until(async () => (await q.getState('bad')) === 'failed');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
  });

  it('keeps jobs enqueued while no worker is running (survives a worker restart)', async () => {
    const name = `test-${randomUUID()}`;
    const producer = new BullMqQueue<{ n: number }>(name, { redisUrl: url!, prefix: 'test' });
    open.push(producer as BullMqQueue<unknown>);
    await producer.enqueue({ n: 1 }, { jobId: 'waiting' });
    expect(await producer.getState('waiting')).toBe('pending');

    const consumer = new BullMqQueue<{ n: number }>(name, { redisUrl: url!, prefix: 'test' });
    open.push(consumer as BullMqQueue<unknown>);
    const seen: number[] = [];
    consumer.process(async (p) => {
      seen.push(p.n);
    });
    await until(async () => (await producer.getState('waiting')) === 'completed');
    expect(seen).toEqual([1]);
  });

  it('answers a readiness ping', async () => {
    expect(await make().ping()).toBe(true);
  });
});
