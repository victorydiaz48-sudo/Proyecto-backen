import { loadConfig } from '@autocontent/config';
import { ProviderNotConfiguredError, vehicleAnalysisSchema } from '@autocontent/shared';
import { makePng } from '@autocontent/shared/testing';
import { describe, expect, it } from 'vitest';
import { createVisionProvider } from '../registry.js';
import { MockVisionProvider } from './mock.js';

describe('MockVisionProvider', () => {
  const vision = new MockVisionProvider();

  it('returns output that satisfies the real provider contract', async () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = await vision.analyze({ image: makePng(400, 400, seed), mime: 'image/png', locale: 'es', jobId: 'j' });
      expect(vehicleAnalysisSchema.safeParse(a).success).toBe(true);
      expect(a.missing_information).toEqual(expect.arrayContaining(['price', 'mileage', 'location', 'contact']));
      for (const k of ['make', 'model', 'version', 'year', 'color'] as const) {
        expect(a.missing_information.includes(k)).toBe(a[k].source === 'unknown');
      }
    }
  });

  it('is deterministic for the same image and localises free text', async () => {
    const img = makePng(400, 400, 7);
    const es = await vision.analyze({ image: img, mime: 'image/png', locale: 'es', jobId: 'j' });
    const again = await vision.analyze({ image: img, mime: 'image/png', locale: 'es', jobId: 'j' });
    const pt = await vision.analyze({ image: img, mime: 'image/png', locale: 'pt', jobId: 'j' });
    expect(again).toEqual(es);
    expect(pt.make).toEqual(es.make);
    expect(pt.color.value).not.toBe(es.color.value);
  });
});

describe('createVisionProvider', () => {
  it('uses the mock in MOCK_MODE', () => {
    expect(createVisionProvider(loadConfig({ MOCK_MODE: 'true' })).name).toBe('mock-vision');
  });

  it('reports NOT_CONFIGURED without crashing when no real provider is available', async () => {
    const v = createVisionProvider(loadConfig({ MOCK_MODE: 'false' }));
    expect((await v.testConnection()).state).toBe('NOT_CONFIGURED');
    await expect(v.analyze({ image: new Uint8Array(), mime: 'image/png', locale: 'es', jobId: 'j' })).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
  });
});
