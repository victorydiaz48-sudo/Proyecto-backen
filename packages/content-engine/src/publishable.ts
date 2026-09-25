import type { AnalysisField, Tagged } from '@autocontent/shared';

/**
 * Publication policy: which analysed facts may appear in public marketing copy.
 *
 *  - detected / user-provided  → always publishable
 *  - inferred                  → only for descriptive fields (never year/trim,
 *                                which a buyer could treat as a factual claim)
 *                                and only with high field confidence
 *  - unknown                   → never
 */
export const INFERRED_ALLOWED_IN_COPY: readonly AnalysisField[] = ['make', 'model', 'body_type', 'estimated_segment'];
export const MIN_INFERRED_CONFIDENCE = 0.7;

export function publishable<T>(field: AnalysisField, tagged: Tagged<T>): T | null {
  if (tagged.value === null) return null;
  switch (tagged.source) {
    case 'detected':
    case 'user-provided':
      return tagged.value;
    case 'inferred':
      return INFERRED_ALLOWED_IN_COPY.includes(field) && (tagged.confidence ?? 0) >= MIN_INFERRED_CONFIDENCE
        ? tagged.value
        : null;
    case 'unknown':
      return null;
  }
}
