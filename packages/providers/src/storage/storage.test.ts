import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import S3rver from 's3rver';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeStorageProviderContract } from './contract.js';
import { LocalDiskStorageProvider } from './local-disk.js';
import { S3StorageProvider } from './s3.js';

const diskRoot = mkdtempSync(join(tmpdir(), 'storage-test-'));
afterAll(() => rmSync(diskRoot, { recursive: true, force: true }));

describeStorageProviderContract('local-disk', () => new LocalDiskStorageProvider(diskRoot, 'x'.repeat(32)));

// A real S3 protocol server (s3rver) running in-process.
const s3Dir = mkdtempSync(join(tmpdir(), 's3rver-'));
let s3: S3rver;
let s3Port = 0;
beforeAll(async () => {
  s3 = new S3rver({ port: 0, address: '127.0.0.1', silent: true, directory: s3Dir, configureBuckets: [{ name: 'media', configs: [] }] });
  s3Port = (await s3.run()).port;
});
afterAll(async () => {
  await s3.close();
  rmSync(s3Dir, { recursive: true, force: true });
});

const s3Provider = () =>
  new S3StorageProvider({
    endpoint: `http://127.0.0.1:${s3Port}`,
    accessKeyId: 'S3RVER',
    secretAccessKey: 'S3RVER',
    bucket: 'media',
    region: 'us-east-1',
    forcePathStyle: true,
  });
describeStorageProviderContract('s3 (s3rver)', s3Provider);

describe('S3StorageProvider errors', () => {
  it('reports a missing bucket clearly and never leaks credentials', async () => {
    const p = new S3StorageProvider({
      endpoint: `http://127.0.0.1:${s3Port}`,
      accessKeyId: 'S3RVER',
      secretAccessKey: 'SUPER_SECRET_VALUE',
      bucket: 'does-not-exist',
      region: 'us-east-1',
      forcePathStyle: true,
    });
    const s = await p.testConnection();
    expect(s.state).toBe('ERROR');
    expect(JSON.stringify(s)).not.toContain('SUPER_SECRET_VALUE');
  });
});

describe('LocalDiskStorageProvider', () => {
  const p = new LocalDiskStorageProvider(diskRoot, 'secret-for-signing-0123456789', 'https://app.example/files');

  it('refuses keys that escape the root', async () => {
    await expect(p.put('../../etc/passwd', new Uint8Array([1]), { mime: 'text/plain' })).rejects.toThrow(/escapes/);
  });

  it('signs and verifies URLs, rejecting tampering and expiry', async () => {
    const url = new URL(await p.signedUrl('dealerships/d/x.png', { expiresInSec: 60 }));
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig')!;
    expect(p.verifySignature('dealerships/d/x.png', 'GET', exp, sig)).toBe(true);
    expect(p.verifySignature('dealerships/OTHER/x.png', 'GET', exp, sig)).toBe(false);
    expect(p.verifySignature('dealerships/d/x.png', 'PUT', exp, sig)).toBe(false);
    expect(p.verifySignature('dealerships/d/x.png', 'GET', exp, sig, (exp + 1) * 1000)).toBe(false);
  });
});
