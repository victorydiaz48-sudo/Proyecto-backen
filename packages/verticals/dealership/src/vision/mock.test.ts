import { createHash } from 'node:crypto';
import { loadConfig } from '@autocontent/config';
import { ProviderNotConfiguredError, silentLogger, type Locale } from '@autocontent/shared';
import { makePng } from '@autocontent/shared/testing';
import { describe, expect, it } from 'vitest';
import type { VisionInput } from '@autocontent/providers';
import { describeVisionProviderContract } from '../testing.js';
import { MockVisionProvider } from './mock.js';
import { createDealershipVisionProvider } from './registry.js';

describeVisionProviderContract('mock-vision', () => new MockVisionProvider());

const opts = { jobId: 'j', organizationId: 'd', idempotencyKey: 'k', signal: new AbortController().signal, logger: silentLogger };
const input = (seed: number, locale: Locale = 'es'): VisionInput => {
  const bytes = makePng(400, 400, seed);
  return {
    images: [{ bytes, mime: 'image/png', width: 400, height: 400, sha256: createHash('sha256').update(bytes).digest('hex') }],
    locale,
  };
};

describe('MockVisionProvider', () => {
  const vision = new MockVisionProvider();

  it('keeps missing_information consistent with unknown fields across samples', async () => {
    for (let seed = 0; seed < 20; seed++) {
      const { data: a } = await vision.analyze(input(seed), opts);
      for (const k of ['make', 'model', 'version', 'year', 'color'] as const) {
        expect(a.missing_information.includes(k)).toBe(a[k].source === 'unknown');
      }
    }
  });

  it('is deterministic for the same image and localises free text', async () => {
    const es = (await vision.analyze(input(7), opts)).data;
    const again = (await vision.analyze(input(7), opts)).data;
    const pt = (await vision.analyze(input(7, 'pt'), opts)).data;
    expect(again).toEqual(es);
    expect(pt.make).toEqual(es.make);
    expect(pt.color.value).not.toBe(es.color.value);
  });

  it('reports usage per image, not money', async () => {
    const res = await vision.analyze(input(1), opts);
    expect(res.usage).toEqual([{ unitType: 'image', units: 1 }]);
  });

  it('aborts a slow call when the signal fires', async () => {
    const slow = new MockVisionProvider({ latencyMs: 5_000 });
    const ac = new AbortController();
    const p = slow.analyze(input(1), { ...opts, signal: ac.signal });
    ac.abort(new Error('deadline'));
    await expect(p).rejects.toThrow('deadline');
  });
});

describe('createDealershipVisionProvider', () => {
  it('uses the mock in MOCK_MODE', () => {
    expect(createDealershipVisionProvider(loadConfig({ MOCK_MODE: 'true' })).name).toBe('mock-vision');
  });

  it('reports NOT_CONFIGURED without crashing when no real provider is available', async () => {
    const v = createDealershipVisionProvider(loadConfig({ MOCK_MODE: 'false' }));
    expect((await v.testConnection()).state).toBe('NOT_CONFIGURED');
    await expect(v.analyze(input(1), opts)).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});
