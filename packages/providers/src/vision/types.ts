import type { Locale } from '@autocontent/shared';
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
  knownFacts?: Record<string, string | number>;
}

/**
 * Photo-recognition contract, generic over the vertical's own analysis shape
 * `TOutput` (dealership's is `VehicleAnalysis`; core has no opinion on it).
 * What an implementation MUST do:
 *
 *  1. Return `data` that passes the vertical's own analysis schema: every
 *     field tagged detected / inferred / unknown, and `unknown` exactly when
 *     value is null. Build the result with the vertical's own normalizer so
 *     every adapter applies the same confidence policy (see
 *     `@autocontent/providers`'s `VISION_POLICY`/`applyPolicy`) and
 *     missing-information rules.
 *  2. Never populate user-only facts (price, mileage, history, engine power,
 *     warranty, specs). Do not smuggle them into free-text fields.
 *  3. Set the subject honestly (not-the-expected-thing, multiple, unclear):
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
 * Every adapter must pass its vertical's `describeVisionProviderContract()`
 * (dealership's lives in `@autocontent/verticals-dealership/testing`).
 */
export interface VisionProvider<TOutput = unknown> extends TestableProvider {
  readonly kind: 'VISION';
  capabilities(): VisionCapabilities;
  analyze(input: VisionInput, opts: ProviderCallOptions): Promise<ProviderResult<TOutput>>;
}
