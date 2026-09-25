import { describe, expect, it } from 'vitest';
import { formatMicros, usdToMicros } from './money.js';
import { qaReportSchema } from './qa.js';
import { videoPlanSchema } from './video-plan.js';

describe('money', () => {
  it('converts and formats micro-USD exactly', () => {
    expect(usdToMicros(0.0025)).toBe(2500n);
    expect(usdToMicros(1.1) + usdToMicros(2.2)).toBe(3_300_000n);
    expect(formatMicros(1_234_567n)).toBe('$1.23');
    expect(formatMicros(2500n)).toBe('$0.0025');
    expect(formatMicros(1_000_000n, 'EUR', 0.9, 'es')).toMatch(/0,90\s?€/);
  });
});

describe('videoPlanSchema', () => {
  const scene = (id: string, durationSec: number) => ({
    id,
    durationSec,
    setting: 'premium studio',
    shot: 'front three-quarter',
    description: 'slow reveal',
  });
  const plan = {
    duration: 15,
    aspect_ratio: '9:16',
    style: 'cinematic-luxury',
    scenes: [scene('a', 5), scene('b', 5), scene('c', 5)],
    camera_movements: ['dolly in'],
    transitions: ['fade'],
    text_overlays: [{ atSec: 1, text: 'Nuevo ingreso' }],
    music_direction: 'ambient piano',
    voiceover: '',
    cta: 'Escríbenos',
  };

  it('accepts a consistent plan', () => {
    expect(videoPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('rejects scenes that do not add up to the duration', () => {
    expect(videoPlanSchema.safeParse({ ...plan, scenes: [scene('a', 5)] }).success).toBe(false);
  });
});

describe('qaReportSchema', () => {
  it('validates the QA contract', () => {
    expect(qaReportSchema.safeParse({ approved: true, errors: [], warnings: [], confidence: 0.9 }).success).toBe(true);
    expect(qaReportSchema.safeParse({ approved: true, errors: [], confidence: 2 }).success).toBe(false);
  });
});
