import type { TestableProvider } from '../status.js';

export interface AnalyticsEvent {
  name: string; // "job.completed", "asset.published" …
  organizationId: string;
  properties?: Record<string, string | number | boolean | null>;
  at?: Date;
}

/** Optional product analytics sink. Must never receive secrets or personal data. */
export interface AnalyticsProvider extends TestableProvider {
  readonly kind: 'ANALYTICS';
  track(event: AnalyticsEvent): Promise<void>;
}
