import { describe, expect, it, vi } from 'vitest';
import { NonRetryableError } from './errors.js';
import { InMemoryJobQueue, backoffDelay } from './queue.js';

const fast = { maxAttempts: 3, baseDelayMs: 1 };

describe('InMemoryJobQueue', () => {
  it('runs a job and marks it completed', async () => {
    const handler = vi.fn(async () => {});
    const q = new InMemoryJobQueue(handler, { retry: fast });
    await q.enqueue({ n: 1 }, { jobId: 'a' });
    await q.onIdle();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(q.getState('a')).toBe('completed');
  });

  it('ignores duplicate job ids (idempotent enqueue)', async () => {
    const handler = vi.fn(async () => {});
    const q = new InMemoryJobQueue(handler, { retry: fast });
    expect((await q.enqueue({}, { jobId: 'a' })).duplicate).toBe(false);
    expect((await q.enqueue({}, { jobId: 'a' })).duplicate).toBe(true);
    await q.onIdle();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures up to maxAttempts, then reports final failure once', async () => {
    const attempts: number[] = [];
    const onFinalFailure = vi.fn(async () => {});
    const q = new InMemoryJobQueue(
      async (_p, ctx) => {
        attempts.push(ctx.attempt);
        throw new Error('provider down');
      },
      { retry: fast, onFinalFailure },
    );
    await q.enqueue({}, { jobId: 'a' });
    await q.onIdle();
    expect(attempts).toEqual([1, 2, 3]);
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
    expect(q.getState('a')).toBe('failed');
  });

  it('succeeds on a later attempt without reporting failure', async () => {
    let calls = 0;
    const onFinalFailure = vi.fn(async () => {});
    const q = new InMemoryJobQueue(
      async () => {
        if (++calls < 2) throw new Error('flaky');
      },
      { retry: fast, onFinalFailure },
    );
    await q.enqueue({}, { jobId: 'a' });
    await q.onIdle();
    expect(calls).toBe(2);
    expect(onFinalFailure).not.toHaveBeenCalled();
    expect(q.getState('a')).toBe('completed');
  });

  it('does not retry non-retryable errors', async () => {
    const handler = vi.fn(async () => {
      throw new NonRetryableError('bad input');
    });
    const q = new InMemoryJobQueue(handler, { retry: fast });
    await q.enqueue({}, { jobId: 'a' });
    await q.onIdle();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff', () => {
    const p = { maxAttempts: 3, baseDelayMs: 2000 };
    expect([1, 2, 3].map((a) => backoffDelay(p, a))).toEqual([2000, 4000, 8000]);
  });
});
