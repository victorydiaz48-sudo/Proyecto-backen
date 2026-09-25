/** Shape used by the admin status page (Phase 9) and by startup logs. */
export type ProviderState = 'CONNECTED' | 'NOT_CONFIGURED' | 'ERROR';

export interface ProviderStatus {
  provider: string;
  state: ProviderState;
  /** Human-readable detail; never contains secrets. */
  detail?: string;
  latencyMs?: number;
}

/** Every provider adapter exposes a cheap connectivity check. */
export interface TestableProvider {
  readonly name: string;
  testConnection(): Promise<ProviderStatus>;
}
