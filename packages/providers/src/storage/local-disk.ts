import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { ProviderStatus } from '../status.js';
import type { StorageProvider, StoredObject } from './types.js';

/**
 * Stores objects on the server's disk. Used when no S3-compatible storage is
 * configured, so the pipeline still works — but a redeploy on Railway/Render
 * wipes the disk unless a volume is mounted, so the status page reports it as
 * "not durable". Signed URLs are HMAC tokens that the API can verify (Phase 9).
 */
export class LocalDiskStorageProvider implements StorageProvider {
  readonly name = 'local-disk';
  readonly kind = 'STORAGE' as const;
  private readonly root: string;

  constructor(
    root: string,
    private readonly signingSecret: string,
    private readonly publicBaseUrl = 'http://localhost/files',
  ) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const p = resolve(this.root, key);
    // Defence in depth: keys are built with storageKey(), but never escape the root.
    if (!p.startsWith(this.root + sep)) throw new Error('Storage key escapes the storage root');
    return p;
  }

  async put(key: string, body: Uint8Array, meta: { mime: string; sha256?: string }): Promise<StoredObject> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
    await writeFile(`${p}.meta.json`, JSON.stringify({ mime: meta.mime, sha256: meta.sha256 }));
    return { key, bytes: body.byteLength, mime: meta.mime, sha256: meta.sha256 };
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(key)));
  }

  async head(key: string): Promise<StoredObject | null> {
    const p = this.path(key);
    try {
      const [s, meta] = await Promise.all([stat(p), readFile(`${p}.meta.json`, 'utf8')]);
      const m = JSON.parse(meta) as { mime: string; sha256?: string };
      return { key, bytes: s.size, mime: m.mime, sha256: m.sha256 };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const p = this.path(key);
    await rm(p, { force: true });
    await rm(`${p}.meta.json`, { force: true });
  }

  async signedUrl(key: string, opts: { expiresInSec: number; method?: 'GET' | 'PUT' }): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + opts.expiresInSec;
    const method = opts.method ?? 'GET';
    const sig = createHmac('sha256', this.signingSecret).update(`${method}\n${key}\n${exp}`).digest('base64url');
    return `${this.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&m=${method}&sig=${sig}`;
  }

  /** Checks a URL produced by signedUrl(). */
  verifySignature(key: string, method: 'GET' | 'PUT', exp: number, sig: string, now = Date.now()): boolean {
    if (exp * 1000 < now) return false;
    const expected = createHmac('sha256', this.signingSecret).update(`${method}\n${key}\n${exp}`).digest();
    const given = Buffer.from(sig, 'base64url');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async testConnection(): Promise<ProviderStatus> {
    const started = Date.now();
    try {
      const probe = join('_health', createHash('sha256').update(String(Math.random())).digest('hex'));
      await this.put(probe, new TextEncoder().encode('ok'), { mime: 'text/plain' });
      await this.delete(probe);
      return {
        provider: this.name,
        state: 'CONNECTED',
        detail: 'Local disk — not durable across redeploys unless a volume is mounted',
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return { provider: this.name, state: 'ERROR', detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
