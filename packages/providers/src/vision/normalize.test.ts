import { ProviderResponseError } from '@autocontent/shared';
import { describe, expect, it } from 'vitest';
import { normalizeVisionOutput } from './normalize.js';

const base = {
  subject: 'vehicle',
  make: { value: 'Toyota', source: 'detected', confidence: 0.95 },
  model: { value: 'Corolla', source: 'detected', confidence: 0.9 },
  confidence: 0.9,
};

describe('normalizeVisionOutput', () => {
  it('applies the confidence policy uniformly', () => {
    const a = normalizeVisionOutput(
      {
        ...base,
        version: { value: 'XEI', source: 'detected', confidence: 0.5 }, // → inferred
        color: { value: 'rojo', source: 'inferred', confidence: 0.2 }, // → unknown
        year: { value: 2021, source: 'user-provided', confidence: 0.9 }, // vision can't claim this → inferred
      },
      'p',
    );
    expect(a.version).toEqual({ value: 'XEI', source: 'inferred', confidence: 0.5 });
    expect(a.color).toEqual({ value: null, source: 'unknown' });
    expect(a.year.source).toBe('inferred');
    expect(a.missing_information).toContain('color');
    expect(a.missing_information).not.toContain('make');
  });

  it('drops impossible or malformed values to unknown', () => {
    const a = normalizeVisionOutput(
      {
        ...base,
        year: { value: 1890, source: 'detected' },
        body_type: { value: 'Sport Utility Vehicle', source: 'detected' },
        estimated_segment: { value: 'Mid Range', source: 'inferred', confidence: 0.8 },
        color: { value: '   ', source: 'detected' },
      },
      'p',
    );
    expect(a.year.source).toBe('unknown');
    expect(a.body_type.source).toBe('unknown');
    expect(a.estimated_segment.value).toBe('mid-range');
    expect(a.color.source).toBe('unknown');
  });

  it('dedupes features, clamps confidence, defaults subject to unclear', () => {
    const a = normalizeVisionOutput(
      {
        make: base.make,
        confidence: 7,
        visual_features: [
          { value: 'LED headlights', source: 'detected' },
          { value: 'led headlights', source: 'detected' },
          { value: 42 },
        ],
        image_quality: ['BLURRY', 'nonsense'],
      },
      'p',
    );
    expect(a.subject).toBe('unclear');
    expect(a.confidence).toBe(1);
    expect(a.visual_features).toEqual([{ value: 'LED headlights', source: 'detected' }]);
    expect(a.image_quality).toEqual(['blurry']);
  });

  it('recognises non-vehicle subjects', () => {
    expect(normalizeVisionOutput({ subject: 'not_vehicle' }, 'p').subject).toBe('not_vehicle');
    expect(normalizeVisionOutput({ subject: 'multiple-vehicles' }, 'p').subject).toBe('multiple_vehicles');
  });

  it('rejects output that is not shaped like an analysis', () => {
    expect(() => normalizeVisionOutput('I think it is a Toyota', 'p')).toThrow(ProviderResponseError);
    expect(() => normalizeVisionOutput({ make: 'Toyota' }, 'p')).toThrow(ProviderResponseError);
  });
});
