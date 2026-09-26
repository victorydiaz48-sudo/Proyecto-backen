import { createHash } from 'node:crypto';
import { silentLogger, type Locale } from '@autocontent/shared';
import { makePng } from '@autocontent/shared/testing';
import type { ProviderCallOptions, VisionImage, VisionProvider } from '@autocontent/providers';
import { describe, expect, it } from 'vitest';
import { USER_ONLY_FIELDS, vehicleAnalysisSchema, type VehicleAnalysis } from '../entities/vehicle-analysis.js';

/**
 * Conformance suite every dealership VisionProvider adapter must pass. Real
 * adapters run it against recorded vendor responses (and live, when a key is
 * present).
 *
 *   describeVisionProviderContract('my-adapter', () => new MyVisionProvider(...))
 */
export function describeVisionProviderContract(label: string, factory: () => VisionProvider<VehicleAnalysis>): void {
  const image = (seed = 1): VisionImage => {
    const bytes = makePng(1080, 810, seed);
    return { bytes, mime: 'image/png', width: 1080, height: 810, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const opts = (signal = new AbortController().signal): ProviderCallOptions => ({
    jobId: 'contract-job',
    organizationId: '00000000-0000-4000-8000-000000000000',
    idempotencyKey: 'contract-job:vision:1',
    signal,
    logger: silentLogger,
  });

  describe(`VisionProvider contract: ${label}`, () => {
    it('declares identity and sane capabilities', () => {
      const p = factory();
      expect(p.name).toMatch(/^[a-z0-9-]+$/);
      expect(p.kind).toBe('VISION');
      const caps = p.capabilities();
      expect(caps.supportedMimes.length).toBeGreaterThan(0);
      expect(caps.maxImagesPerCall).toBeGreaterThanOrEqual(1);
      expect(caps.maxImageBytes).toBeGreaterThan(0);
    });

    it.each<Locale>(['es', 'pt', 'en'])('returns a schema-valid, fully tagged analysis (%s)', async (locale) => {
      const res = await factory().analyze({ images: [image()], locale }, opts());
      expect(vehicleAnalysisSchema.safeParse(res.data).success).toBe(true);
      expect(res.model.length).toBeGreaterThan(0);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
      expect(res.usage.length).toBeGreaterThan(0);
      for (const u of res.usage) expect(u.units).toBeGreaterThanOrEqual(0);
    });

    it('never claims user-provided facts and always lists user-only fields as missing', async () => {
      const res = await factory().analyze(
        { images: [image(2)], locale: 'es', knownFacts: { make: 'Seat', year: 2019 } },
        opts(),
      );
      const a = res.data;
      for (const k of ['make', 'model', 'version', 'year', 'color', 'body_type', 'estimated_segment'] as const) {
        expect(a[k].source).not.toBe('user-provided');
      }
      expect(a.missing_information).toEqual(expect.arrayContaining([...USER_ONLY_FIELDS]));
      // No fields beyond the contract, and no user-only facts hidden in free text.
      expect(Object.keys(a).sort()).toEqual(Object.keys(vehicleAnalysisSchema.shape).sort());
      const freeText = [...a.visual_features.map((f) => f.value), ...a.visible_details].join(' | ');
      expect(freeText).not.toMatch(/[$€£]|\bkm\b|price|precio|preço|mileage|kilometraje|quilometragem|warrant|garant|\bhp\b|\bcv\b/i);
    });

    it('stops when the caller aborts', async () => {
      const ac = new AbortController();
      ac.abort(new Error('deadline'));
      await expect(factory().analyze({ images: [image()], locale: 'es' }, opts(ac.signal))).rejects.toThrow();
    });

    it('reports a connection status without spending credit', async () => {
      const p = factory();
      const s = await p.testConnection({ signal: new AbortController().signal });
      expect(s.provider).toBe(p.name);
      expect(['CONNECTED', 'NOT_CONFIGURED', 'ERROR']).toContain(s.state);
    });
  });
}
