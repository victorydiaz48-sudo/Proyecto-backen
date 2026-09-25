import type { Locale, VehicleAnalysis } from '@autocontent/shared';
import type { TestableProvider } from '../status.js';

export interface VisionInput {
  image: Uint8Array;
  mime: string;
  /** Language for free-text fields (color, features). Enum fields stay canonical. */
  locale: Locale;
  /** Correlation id for logs / provider request tracing. */
  jobId: string;
}

/**
 * Contract for vehicle recognition. Implementations MUST:
 *  - return data that passes `vehicleAnalysisSchema`
 *  - tag every field (detected / inferred / unknown) and never invent values:
 *    if a field cannot be seen or reasonably inferred, it is `unknown` + null
 *  - never populate user-only facts (price, mileage, history, specs)
 */
export interface VisionProvider extends TestableProvider {
  analyze(input: VisionInput): Promise<VehicleAnalysis>;
}
