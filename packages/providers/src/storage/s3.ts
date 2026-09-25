import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ProviderStatus } from '../status.js';
import type { StorageProvider, StoredObject } from './types.js';

export interface S3StorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** R2 uses "auto"; AWS needs the bucket's region. */
  region?: string;
  /** Path-style URLs (needed by MinIO and some S3-compatible services). */
  forcePathStyle?: boolean;
}

/**
 * S3-compatible object storage (Cloudflare R2, AWS S3, Backblaze B2, MinIO…).
 * Objects are private; access is only through short-lived signed URLs.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  readonly kind = 'STORAGE' as const;
  private readonly client: S3Client;

  constructor(private readonly cfg: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region ?? 'auto',
      forcePathStyle: cfg.forcePathStyle ?? false,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Only send checksums when the service requires them (R2/B2 compatibility).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, body: Uint8Array, meta: { mime: string; sha256?: string }): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: meta.mime,
        Metadata: meta.sha256 ? { sha256: meta.sha256 } : undefined,
      }),
    );
    return { key, bytes: body.byteLength, mime: meta.mime, sha256: meta.sha256 };
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty body for ${key}`);
    return res.Body.transformToByteArray();
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { key, bytes: res.ContentLength ?? 0, mime: res.ContentType ?? 'application/octet-stream', sha256: res.Metadata?.sha256 };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async signedUrl(key: string, opts: { expiresInSec: number; method?: 'GET' | 'PUT' }): Promise<string> {
    const cmd =
      opts.method === 'PUT'
        ? new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key })
        : new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: opts.expiresInSec });
  }

  async testConnection(opts?: { signal?: AbortSignal }): Promise<ProviderStatus> {
    const started = Date.now();
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }), { abortSignal: opts?.signal });
      return { provider: this.name, state: 'CONNECTED', detail: `Bucket "${this.cfg.bucket}"`, latencyMs: Date.now() - started };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      const detail =
        status === 403 ? 'Access denied: check STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY'
        : status === 404 ? `Bucket "${this.cfg.bucket}" not found`
        : 'Could not reach the storage endpoint';
      // Never include credentials or raw SDK errors (they can echo request details).
      return { provider: this.name, state: 'ERROR', detail };
    }
  }
}
