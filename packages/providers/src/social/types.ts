import type { TestableProvider } from '../status.js';
import type { ProviderCallOptions, ProviderResult } from '../types.js';

export const SOCIAL_PLATFORMS = [
  'INSTAGRAM',
  'FACEBOOK',
  'TIKTOK',
  'YOUTUBE',
  'LINKEDIN',
  'X',
  'THREADS',
  'PINTEREST',
  'BLUESKY',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Credentials of ONE organization (e.g. its own Blotato API key). */
export interface SocialCredentials {
  apiKey: string;
}

export interface SocialAccount {
  externalAccountId: string;
  platform: SocialPlatform;
  displayName: string;
  handle?: string;
}

export interface PublishRequest {
  account: SocialAccount;
  text: string;
  /** Publicly fetchable, short-lived URLs (signed storage URLs), in display order. */
  media: { url: string; kind: 'image' | 'video'; mime: string }[];
  /** Absent = publish now. */
  scheduledAt?: Date;
}

export type PostState = 'scheduled' | 'publishing' | 'published' | 'failed';

export interface PostStatus {
  externalPostId: string;
  state: PostState;
  url?: string;
  error?: string;
}

/**
 * Publishing adapter. Default implementation: Blotato (Phase 10). A direct
 * Meta Graph adapter can implement this later without changing callers.
 * Callers — not adapters — enforce the organization's publishing mode.
 */
export interface SocialPublishingProvider extends TestableProvider {
  readonly kind: 'SOCIAL_PUBLISHING';
  supportedPlatforms(): SocialPlatform[];
  listAccounts(creds: SocialCredentials, opts: ProviderCallOptions): Promise<SocialAccount[]>;
  publish(req: PublishRequest, creds: SocialCredentials, opts: ProviderCallOptions): Promise<ProviderResult<PostStatus>>;
  getPostStatus(externalPostId: string, creds: SocialCredentials, opts: ProviderCallOptions): Promise<PostStatus>;
}
