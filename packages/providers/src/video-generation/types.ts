import type { VideoPlan } from '@autocontent/shared';
import type { TestableProvider } from '../status.js';
import type { ProviderCallOptions, ProviderResult } from '../types.js';
import type { IdentityTrait } from '../image-generation/types.js';

export interface VideoRenderInput {
  plan: VideoPlan;
  /** Reference frames: the original photo and generated scene images. */
  references: { bytes: Uint8Array; mime: string; role: 'original' | 'scene' }[];
  preserve: IdentityTrait[];
}

export type VideoRenderState = 'queued' | 'rendering' | 'succeeded' | 'failed';

export interface VideoRenderStatus {
  externalId: string;
  state: VideoRenderState;
  progress?: number; // 0..1
  /** Present when succeeded. The worker downloads it into our storage. */
  resultUrl?: string;
  error?: string;
}

/**
 * Video rendering is slow (minutes) and asynchronous: submit, then poll or
 * receive a signed completion webhook. Submissions must be idempotent on
 * opts.idempotencyKey so a retried job never pays for a second render.
 */
export interface VideoGenerationProvider extends TestableProvider {
  readonly kind: 'VIDEO_GENERATION';
  /** Upper-bound cost inputs for pre-run estimates (seconds of video, etc.). */
  maxDurationSec(): number;
  submit(input: VideoRenderInput, opts: ProviderCallOptions): Promise<ProviderResult<{ externalId: string }>>;
  getStatus(externalId: string, opts: ProviderCallOptions): Promise<VideoRenderStatus>;
  /** Verifies a completion webhook's signature; returns the status it carries, or null if invalid. */
  parseWebhook?(headers: Record<string, string | undefined>, rawBody: Buffer): VideoRenderStatus | null;
}
