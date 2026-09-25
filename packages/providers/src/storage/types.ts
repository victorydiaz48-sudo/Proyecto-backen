import type { TestableProvider } from '../status.js';

export interface StoredObject {
  key: string;
  bytes: number;
  mime: string;
  sha256?: string;
}

/**
 * S3-compatible object storage. Keys always start with
 * `dealerships/{dealershipId}/` (see storageKey()), so one bucket can hold every
 * tenant without mixing data. Objects are private; access is through
 * short-lived signed URLs only.
 */
export interface StorageProvider extends TestableProvider {
  readonly kind: 'STORAGE';
  put(key: string, body: Uint8Array, meta: { mime: string; sha256?: string }): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, opts: { expiresInSec: number; method?: 'GET' | 'PUT' }): Promise<string>;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Builds a tenant-prefixed key and refuses path tricks ("..", "/", empty). */
export function storageKey(dealershipId: string, ...segments: string[]): string {
  for (const s of [dealershipId, ...segments]) {
    if (!SAFE_SEGMENT.test(s) || s === '.' || s === '..') throw new Error(`Unsafe storage key segment: "${s}"`);
  }
  return ['dealerships', dealershipId, ...segments].join('/');
}
