import { unknownField, type FieldSource, type Tagged } from '@autocontent/shared';

/**
 * Shared confidence policy applied to every vision provider's output, so
 * swapping providers (or verticals) never changes what counts as "detected".
 * Generic over the tagged field's value type — a vertical's own normalizer
 * calls this per field.
 */
export const VISION_POLICY = {
  /** Below this, a "detected" field is downgraded to "inferred". */
  minDetectedConfidence: 0.6,
  /** Below this, an "inferred" field is dropped to "unknown". */
  minInferredConfidence: 0.4,
  minYear: 1950,
  maxFeatures: 12,
  maxDetails: 12,
} as const;

export const clamp01 = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? undefined : Math.min(1, Math.max(0, n)));

export function applyPolicy<T>(value: T | null, rawSource: string | undefined, rawConfidence: number | undefined): Tagged<T> {
  if (value === null) return unknownField();
  const confidence = clamp01(rawConfidence);
  // A vision model can only see or guess; it can never claim "user-provided".
  let source: FieldSource = rawSource === 'detected' ? 'detected' : rawSource === 'unknown' ? 'unknown' : 'inferred';
  if (source === 'unknown') return unknownField();
  if (source === 'detected' && confidence !== undefined && confidence < VISION_POLICY.minDetectedConfidence) {
    source = 'inferred';
  }
  if (source === 'inferred' && confidence !== undefined && confidence < VISION_POLICY.minInferredConfidence) {
    return unknownField();
  }
  return confidence === undefined ? { value, source } : { value, source, confidence };
}

export function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length > 0 && t.length <= 120 ? t : null;
}

export function oneOf<T extends string>(allowed: readonly T[], v: unknown): T | null {
  if (typeof v !== 'string') return null;
  const k = v.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const hit = allowed.find((a) => a === k || a.replace(/-/g, '') === k.replace(/-/g, ''));
  return hit ?? null;
}

export function year(v: unknown): number | null {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  const max = new Date().getUTCFullYear() + 1;
  return n >= VISION_POLICY.minYear && n <= max ? n : null;
}
