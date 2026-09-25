import { describe, expect, it } from 'vitest';
import { computeCostMicros, costConfigSchema } from './cost.js';
import { storageKey } from './storage/types.js';

describe('computeCostMicros', () => {
  const config = costConfigSchema.parse([
    { unitType: '1k_input_tokens', costMicros: 3000 },
    { unitType: '1k_output_tokens', costMicros: 15000 },
    { unitType: 'image', costMicros: 40000 },
  ]);

  it('prices usage from configuration only', () => {
    const r = computeCostMicros(config, [
      { unitType: '1k_input_tokens', units: 1.5 },
      { unitType: '1k_output_tokens', units: 0.4 },
    ]);
    expect(r.totalMicros).toBe(4500n + 6000n);
    expect(r.unpriced).toEqual([]);
  });

  it('flags usage with no configured price instead of guessing', () => {
    const r = computeCostMicros(config, [{ unitType: 'second', units: 15 }]);
    expect(r.totalMicros).toBe(0n);
    expect(r.unpriced).toEqual([{ unitType: 'second', units: 15 }]);
  });
});

describe('storageKey', () => {
  it('always prefixes the tenant and rejects traversal', () => {
    expect(storageKey('d1', 'vehicles', 'v1', 'originals', 'abc.jpg')).toBe('dealerships/d1/vehicles/v1/originals/abc.jpg');
    expect(() => storageKey('d1', '..', 'x')).toThrow();
    expect(() => storageKey('d1', 'a/b')).toThrow();
    expect(() => storageKey('d1', '')).toThrow();
  });
});
