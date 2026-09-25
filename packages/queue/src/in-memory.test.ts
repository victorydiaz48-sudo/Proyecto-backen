import { NonRetryableError } from '@autocontent/shared';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryQueue } from './in-memory.js';
import { backoffDelay } from './types.js';

const fast = { maxRetries: 3, baseDelayMs: 1 };

function queueWith<P>(handler: (p: P, ctx: { attempt: number }) => Promise<void>, onFinalFailure?: () => Promise<void>) {
  const q = new InMemoryQueue<P>({ retry: fast });
  q.process(handler, { onFinalFailure });
  return q;
}

describe('InMemoryQueue', () => {
  it('runs a job and marks it completed', async () => {
    const handler = vi.fn(async () => {});
    const q = queueWith(handler);
    await q.enqueue({ n: 1 }, { jobId: 'a' });
    await q.onIdle();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await q.getState('a')).toBe('completed');
  });

  it('holds jobs enqueued before a worker is registered', async () => {
    const q = new InMemoryQueue<number>({ retry: fast });
    const seen: number[] = [];
    await q.enqueue(1, { jobId: 'a' });
    await q.enqueue(2, { jobId: 'b' });
    expect(await q.getState('a')).toBe('pending');
    q.process(async (n) => {
      seen.push(n);
    });
    await q.onIdle();
    expect(seen).toEqual([1, 2]);
  });

  it('ignores duplicate job ids (idempotent enqueue)', async () => {
    const handler = vi.fn(async () => {});
    const q = queueWith(handler);
    expect((await q.enqueue({}, { jobId: 'a' })).duplicate).toBe(false);
    expect((await q.enqueue({}, { jobId: 'a' })).duplicate).toBe(true);
    await q.onIdle();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('makes 1 attempt + MAX_RETRIES (3) retries, then reports final failure once', async () => {
    const attempts: number[] = [];
    const onFinalFailure = vi.fn(async () => {});
    const q = queueWith(async (_p, ctx) => {
      attempts.push(ctx.attempt);
      throw new Error('provider down');
    }, onFinalFailure);
    await q.enqueue({}, { jobId: 'a' });
    await q.onIdle();
    expect(attempts).toEqual([1, 2, 3, 4]);
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
    expect(await q.getState('a')).toBe('failed');
  });

  it('succeeds on a later attempt without reporting failure', async () => {
    let calls = 0;
    const onFinalFailure = vi.fn(async () => {});
    const q = queueWith(async () => {
      if (++calls < 2) throw new Error('flaky');
    }, onFinalFailure);
    await q.enqueue({}, { jobId: 'a' });
    await q.onIdle();
    expect(calls).toBe(2);
    expect(onFinalFailure).not.toHaveBeenCalled();
  });

  it('does not retry non-retryable errors', async () => {
    const handler = vi.fn(async () => {
      throw new NonRetryableError('bad input');
    });
    const q = queueWith(handler);
    await q.enqueue({}, { jobId: 'a' });
    await q.onIdle();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('respects concurrency', async () => {
    let running = 0;
    let peak = 0;
    const q = new InMemoryQueue<number>({ retry: fast });
    q.process(
      async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      },
      { concurrency: 2 },
    );
    for (let i = 0; i < 6; i++) await q.enqueue(i, { jobId: `j${i}` });
    await q.onIdle();
    expect(peak).toBe(2);
  });

  it('honours delayMs', async () => {
    const q = queueWith(async () => {});
    await q.enqueue({}, { jobId: 'a', delayMs: 30 });
    await new Promise((r) => setTimeout(r, 10));
    expect(await q.getState('a')).toBe('pending');
    await q.onIdle();
    expect(await q.getState('a')).toBe('completed');
  });

  it('uses exponential backoff: 2s, 4s, 8s', () => {
    const p = { maxRetries: 3, baseDelayMs: 2000 };
    expect([1, 2, 3].map((n) => backoffDelay(p, n))).toEqual([2000, 4000, 8000]);
  });
});
