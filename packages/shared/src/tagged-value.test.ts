import { describe, expect, it } from 'vitest';
import { deterministicJobId } from './ids.js';
import { taggedSchema } from './tagged-value.js';
import { z } from 'zod';

describe('tagged fields', () => {
  const s = taggedSchema(z.string());
  it('requires unknown <=> null', () => {
    expect(s.safeParse({ value: null, source: 'unknown' }).success).toBe(true);
    expect(s.safeParse({ value: 'Toyota', source: 'detected' }).success).toBe(true);
    expect(s.safeParse({ value: 'Toyota', source: 'unknown' }).success).toBe(false);
    expect(s.safeParse({ value: null, source: 'inferred' }).success).toBe(false);
  });
});

describe('deterministicJobId', () => {
  it('is stable per key, distinct across keys, and UUID-shaped', () => {
    const a = deterministicJobId('tg:1:2');
    expect(a).toBe(deterministicJobId('tg:1:2'));
    expect(a).not.toBe(deterministicJobId('tg:1:3'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
