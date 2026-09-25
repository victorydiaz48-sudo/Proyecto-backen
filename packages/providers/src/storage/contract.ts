import { describe, expect, it } from 'vitest';
import { storageKey, type StorageProvider } from './types.js';

/** Conformance suite every StorageProvider must pass. */
export function describeStorageProviderContract(label: string, factory: () => StorageProvider): void {
  describe(`StorageProvider contract: ${label}`, () => {
    const key = (name: string) => storageKey('00000000-0000-4000-8000-000000000001', 'vehicles', 'v1', 'originals', name);

    it('round-trips bytes and metadata', async () => {
      const s = factory();
      const body = new Uint8Array([1, 2, 3, 250, 0, 7]);
      await s.put(key('a.bin'), body, { mime: 'image/png', sha256: 'abc' });
      expect(Array.from(await s.get(key('a.bin')))).toEqual(Array.from(body));
      expect(await s.head(key('a.bin'))).toMatchObject({ bytes: 6, mime: 'image/png', sha256: 'abc' });
    });

    it('overwrites idempotently and deletes', async () => {
      const s = factory();
      await s.put(key('b.bin'), new Uint8Array([1]), { mime: 'image/png' });
      await s.put(key('b.bin'), new Uint8Array([2, 2]), { mime: 'image/png' });
      expect((await s.head(key('b.bin')))?.bytes).toBe(2);
      await s.delete(key('b.bin'));
      expect(await s.head(key('b.bin'))).toBeNull();
      await s.delete(key('b.bin')); // deleting twice is fine
    });

    it('returns null for missing objects', async () => {
      expect(await factory().head(key('missing.bin'))).toBeNull();
    });

    it('produces signed URLs that expire', async () => {
      const url = await factory().signedUrl(key('a.bin'), { expiresInSec: 60 });
      expect(url).toMatch(/^https?:\/\//);
      expect(url).toMatch(/exp|Expires|X-Amz-Expires/);
    });

    it('reports a connection status', async () => {
      const s = factory();
      expect((await s.testConnection()).state).toBe('CONNECTED');
    });
  });
}
