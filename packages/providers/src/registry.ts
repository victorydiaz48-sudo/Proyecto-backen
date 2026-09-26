import type { AppConfig } from '@autocontent/config';
import { ProviderNotConfiguredError } from '@autocontent/shared';
import type { ProviderStatus } from './status.js';
import { randomBytes } from 'node:crypto';
import { LocalDiskStorageProvider } from './storage/local-disk.js';
import { S3StorageProvider } from './storage/s3.js';
import type { StorageProvider } from './storage/types.js';
import { MockVisionProvider } from './vision/mock.js';
import type { VisionCapabilities, VisionProvider } from './vision/types.js';

/**
 * Placeholder used when no real provider is configured: the app keeps running,
 * the status page shows NOT_CONFIGURED, and jobs fail fast with a clear,
 * non-retryable error instead of crashing.
 */
export class UnconfiguredVisionProvider implements VisionProvider {
  readonly kind = 'VISION' as const;

  constructor(
    readonly name: string,
    private readonly reason: string,
  ) {}

  capabilities(): VisionCapabilities {
    return {
      supportedMimes: ['image/jpeg', 'image/png', 'image/webp'],
      maxImageBytes: 0,
      maxImageDimension: 0,
      maxImagesPerCall: 1,
      localizedFreeText: false,
    };
  }

  async analyze(): Promise<never> {
    throw new ProviderNotConfiguredError(this.name);
  }

  async testConnection(): Promise<ProviderStatus> {
    return { provider: this.name, state: 'NOT_CONFIGURED', detail: this.reason };
  }
}

/**
 * The only place that decides which vision implementation is used.
 * Phase 2 moves this behind a database-backed registry that resolves
 * per-organization overrides (APIProvider rows); callers don't change.
 */
export function createVisionProvider(config: AppConfig): VisionProvider {
  if (config.MOCK_MODE) {
    return new MockVisionProvider({ latencyMs: config.MOCK_LATENCY_MS });
  }
  // Phase 4 plugs the real vision adapter in here when AI_API_KEY is set.
  return new UnconfiguredVisionProvider(
    'vision',
    config.AI_API_KEY
      ? 'Real vision provider not implemented yet (Phase 4). Set MOCK_MODE=true.'
      : 'AI_API_KEY is not set',
  );
}

/**
 * S3-compatible storage when all STORAGE_* variables are set; otherwise the
 * server's disk (works, but is wiped by redeploys unless a volume is mounted —
 * `durable: false` is surfaced on /health).
 */
export function createStorageProvider(config: AppConfig): { storage: StorageProvider; durable: boolean } {
  if (config.STORAGE_ENDPOINT && config.STORAGE_ACCESS_KEY && config.STORAGE_SECRET_KEY && config.STORAGE_BUCKET) {
    return {
      durable: true,
      storage: new S3StorageProvider({
        endpoint: config.STORAGE_ENDPOINT,
        accessKeyId: config.STORAGE_ACCESS_KEY,
        secretAccessKey: config.STORAGE_SECRET_KEY,
        bucket: config.STORAGE_BUCKET,
        region: config.STORAGE_REGION,
        forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
      }),
    };
  }
  // Signed local URLs only need to survive one process lifetime.
  return { durable: false, storage: new LocalDiskStorageProvider(config.STORAGE_LOCAL_DIR, randomBytes(32).toString('hex')) };
}
