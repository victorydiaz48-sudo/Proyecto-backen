import type { Locale, VehicleAnalysis } from '@autocontent/shared';
import type { TestableProvider } from '../status.js';
import type { ProviderCallOptions, ProviderResult } from '../types.js';

export type VisionMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface VisionCapabilities {
  supportedMimes: VisionMime[];
  maxImageBytes: number;
  maxImageDimension: number;
  /** Phase 4 sends one image; multi-angle analysis can use more later. */
  maxImagesPerCall: number;
  /** Can return free-text fields (color, features) in the requested locale. */
  localizedFreeText: boolean;
}

/** An image that has already passed validateImage() and been stored. */
export interface VisionImage {
  bytes: Uint8Array;
  mime: VisionMime;
  width: number;
  height: number;
  sha256: string;
}

export interface VisionInput {
  /** At least one; never more than capabilities().maxImagesPerCall. */
  images: VisionImage[];
  /** Language for free-text fields. Enum fields (body_type, segment…) stay canonical. */
  locale: Locale;
  /**
   * Facts the user already gave. Only for consistency (e.g. to flag a mismatch);
   * the provider must not copy them into its output as if it saw them.
   */
  knownFacts?: Partial<{ make: string; model: string; version: string; year: number }>;
}

/**
 * Vehicle recognition contract. What an implementation MUST do:
 *
 *  1. Return `data` that passes `vehicleAnalysisSchema`: every field tagged
 *     detected / inferred / unknown, and `unknown` exactly when value is null.
 *     Build the result with `normalizeVisionOutput()` so every adapter applies
 *     the same confidence policy and missing-information rules.
 *  2. Never populate user-only facts (price, mileage, history, engine power,
 *     warranty, specs). The schema has no fields for them; do not smuggle them
 *     into visual_features or visible_details.
 *  3. Set `subject` honestly ('not_vehicle', 'multiple_vehicles', 'unclear'):
 *     the pipeline stops there, before any further spend.
 *  4. Take prompts from the versioned prompt registry, never inline strings.
 *  5. Throw the typed errors from @autocontent/shared:
 *       ProviderAuthError           bad credentials       (not retried)
 *       ProviderRateLimitError      vendor 429            (retried)
 *       ProviderTimeoutError        deadline / abort      (retried)
 *       ProviderResponseError       invalid output        (one repair, then retried)
 *       ProviderRefusedError        content refused       (not retried)
 *       ProviderNotConfiguredError  no credentials        (not retried)
 *  6. Stop work when `opts.signal` aborts.
 *  7. Report usage (tokens/images/requests) — not money.
 *  8. Receive credentials through its constructor only; never log them or
 *     return them.
 *
 * Every adapter must pass `describeVisionProviderContract()` from
 * `@autocontent/providers/testing`.
 */
export interface VisionProvider extends TestableProvider {
  readonly kind: 'VISION';
  capabilities(): VisionCapabilities;
  analyze(input: VisionInput, opts: ProviderCallOptions): Promise<ProviderResult<VehicleAnalysis>>;
}
