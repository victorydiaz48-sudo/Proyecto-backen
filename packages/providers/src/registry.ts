import type { AppConfig } from '@autocontent/config';
import { ProviderNotConfiguredError } from '@autocontent/shared';
import type { ProviderStatus } from './status.js';
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
 * per-dealership overrides (APIProvider rows); callers don't change.
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
