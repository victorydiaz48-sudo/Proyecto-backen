import type { AppConfig } from '@autocontent/config';
import { UnconfiguredVisionProvider, type VisionProvider } from '@autocontent/providers';
import type { VehicleAnalysis } from '../entities/vehicle-analysis.js';
import { MockVisionProvider } from './mock.js';

/**
 * The only place that decides which vision implementation the dealership
 * module uses. Phase 4 plugs a real adapter in here when AI_API_KEY is set;
 * callers (apps/server) don't change.
 */
export function createDealershipVisionProvider(config: AppConfig): VisionProvider<VehicleAnalysis> {
  if (config.MOCK_MODE) {
    return new MockVisionProvider({ latencyMs: config.MOCK_LATENCY_MS });
  }
  return new UnconfiguredVisionProvider(
    'vision',
    config.AI_API_KEY
      ? 'Real vision provider not implemented yet (Phase 4). Set MOCK_MODE=true.'
      : 'AI_API_KEY is not set',
  );
}
