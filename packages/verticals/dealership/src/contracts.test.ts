import { describe, expect, it } from 'vitest';
import { vehiclePatch } from './contracts.js';

describe('vehicle contracts', () => {
  it('rejects malformed input', () => {
    expect(vehiclePatch.safeParse({ mileageKm: -5 }).success).toBe(false);
    expect(vehiclePatch.safeParse({ year: 1800 }).success).toBe(false);
  });
});
