/** Shape used by the admin status page and startup logs. */
export type ProviderState = 'CONNECTED' | 'NOT_CONFIGURED' | 'ERROR';

export type ProviderKind =
  | 'TELEGRAM'
  | 'VISION'
  | 'TEXT_GENERATION'
  | 'IMAGE_GENERATION'
  | 'VIDEO_GENERATION'
  | 'STORAGE'
  | 'SOCIAL_PUBLISHING'
  | 'ANALYTICS';

export interface ProviderStatus {
  provider: string;
  state: ProviderState;
  /** Human-readable detail; never contains secrets. */
  detail?: string;
  latencyMs?: number;
}

/** Every provider adapter exposes an identity and a cheap connectivity check. */
export interface TestableProvider {
  /** Adapter id; matches APIProvider.adapter in the database. */
  readonly name: string;
  readonly kind: ProviderKind;
  /** Must not spend generation credit. */
  testConnection(opts?: { signal?: AbortSignal }): Promise<ProviderStatus>;
}
