import type { VehicleAnalysis } from '@autocontent/shared';
import { describe, expect, it } from 'vitest';
import { generateCaption } from './caption.js';

const base: VehicleAnalysis = {
  make: { value: 'Toyota', source: 'detected', confidence: 0.95 },
  model: { value: 'Corolla', source: 'detected', confidence: 0.9 },
  version: { value: 'XEI', source: 'inferred', confidence: 0.55 },
  year: { value: 2021, source: 'inferred', confidence: 0.6 },
  color: { value: 'blanco perla', source: 'detected', confidence: 0.9 },
  body_type: { value: 'sedan', source: 'detected' },
  estimated_segment: { value: 'luxury', source: 'inferred', confidence: 0.85 },
  visual_features: [
    { value: 'faros LED', source: 'detected' },
    { value: 'techo panorámico', source: 'inferred' },
  ],
  visible_details: [],
  confidence: 0.9,
  missing_information: ['price', 'mileage', 'location', 'contact', 'financing'],
  provider: 'test',
};

describe('generateCaption', () => {
  it('uses detected facts and leaves out inferred year/trim and inferred features', () => {
    const { text, usedFields } = generateCaption(base, 'es');
    expect(text).toContain('Toyota Corolla');
    expect(text).toContain('blanco perla');
    expect(text).toContain('Faros LED');
    expect(text).not.toContain('2021');
    expect(text).not.toContain('XEI');
    expect(text).not.toContain('panorámico');
    expect(usedFields).not.toContain('year');
    expect(text).toContain('#Toyota #Corolla #AutosEnVenta');
  });

  it('includes trim and year once they are user-provided', () => {
    const { text } = generateCaption(
      { ...base, year: { value: 2021, source: 'user-provided' }, version: { value: 'XEI', source: 'user-provided' } },
      'es',
    );
    expect(text).toContain('Toyota Corolla XEI 2021');
  });

  it('never mentions price, mileage or financing figures it was not given', () => {
    const { text } = generateCaption(base, 'es');
    expect(text).not.toMatch(/\$|€|\bkm\b|financ/i);
  });

  it('falls back gracefully when the vehicle is not identified', () => {
    const unknown = { value: null, source: 'unknown' } as const;
    const { text } = generateCaption(
      { ...base, make: unknown, model: unknown, version: unknown, year: unknown, color: unknown, estimated_segment: unknown, visual_features: [] },
      'pt',
    );
    expect(text).toContain('Sedã');
    expect(text).toContain('Pronto para o próximo dono.');
    expect(text).not.toContain('null');
  });

  it('drops low-confidence inferred identity', () => {
    const { text } = generateCaption({ ...base, model: { value: 'Corolla', source: 'inferred', confidence: 0.4 } }, 'en');
    expect(text).not.toContain('Corolla');
  });
});
