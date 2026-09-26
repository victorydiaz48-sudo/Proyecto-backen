import type { TestableProvider } from '../status.js';
import type { ProviderCallOptions, ProviderResult } from '../types.js';

/** Vehicle traits an image/video transformation must keep unchanged. */
export const IDENTITY_TRAITS = ['body_shape', 'wheels', 'headlights', 'grille', 'color', 'badges', 'proportions'] as const;
export type IdentityTrait = (typeof IDENTITY_TRAITS)[number];

export interface ImageSize {
  width: number;
  height: number;
}

export interface ImageTransformInput {
  /** The original, validated vehicle photo. */
  source: { bytes: Uint8Array; mime: string; width: number; height: number };
  /** Scene id from the template, e.g. "premium-studio", "urban-night", "highway", "showroom". */
  scene: string;
  /** Full scene prompt from the prompt registry (never inline). */
  prompt: { id: string; version: string; text: string; negative?: string };
  preserve: IdentityTrait[];
  size: ImageSize;
  /** Reproducible output where the vendor supports it. */
  seed?: number;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

/**
 * Places the real vehicle into a marketing scene. Must not alter the vehicle
 * itself; the image engine runs identity checks on the result (Phase 6/8).
 */
export interface ImageGenerationProvider extends TestableProvider {
  readonly kind: 'IMAGE_GENERATION';
  supportedSizes(): ImageSize[];
  transform(input: ImageTransformInput, opts: ProviderCallOptions): Promise<ProviderResult<GeneratedImage>>;
}
