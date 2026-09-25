import {
  BODY_TYPES,
  IMAGE_QUALITY_ISSUES,
  PHOTO_SUBJECTS,
  ProviderResponseError,
  SEGMENTS,
  computeMissingInformation,
  vehicleAnalysisSchema,
  type FieldSource,
  type Tagged,
  type VehicleAnalysis,
} from '@autocontent/shared';
import { z } from 'zod';

/**
 * Shared confidence policy applied to every vision provider's output, so
 * swapping providers never changes what counts as "detected".
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

/** Lenient shape an adapter maps the vendor's response into. */
const rawTagged = z
  .object({
    value: z.unknown().optional(),
    source: z.string().optional(),
    confidence: z.number().optional(),
  })
  .nullish();

export const visionCandidateSchema = z.object({
  subject: z.string().optional(),
  image_quality: z.array(z.string()).optional(),
  make: rawTagged,
  model: rawTagged,
  version: rawTagged,
  year: rawTagged,
  color: rawTagged,
  body_type: rawTagged,
  estimated_segment: rawTagged,
  visual_features: z.array(z.object({ value: z.unknown(), source: z.string().optional() })).optional(),
  visible_details: z.array(z.unknown()).optional(),
  confidence: z.number().optional(),
});
export type VisionCandidate = z.input<typeof visionCandidateSchema>;

const clamp01 = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? undefined : Math.min(1, Math.max(0, n)));

const unknownField = <T>(): Tagged<T> => ({ value: null, source: 'unknown' });

function applyPolicy<T>(value: T | null, rawSource: string | undefined, rawConfidence: number | undefined): Tagged<T> {
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

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length > 0 && t.length <= 120 ? t : null;
}

function oneOf<T extends string>(allowed: readonly T[], v: unknown): T | null {
  if (typeof v !== 'string') return null;
  const k = v.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const hit = allowed.find((a) => a === k || a.replace(/-/g, '') === k.replace(/-/g, ''));
  return hit ?? null;
}

function year(v: unknown): number | null {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  const max = new Date().getUTCFullYear() + 1;
  return n >= VISION_POLICY.minYear && n <= max ? n : null;
}

/**
 * Turn an adapter's mapped vendor output into a contract-valid
 * VehicleAnalysis: applies the confidence policy, drops invalid values to
 * "unknown", recomputes missing_information, and validates the result.
 *
 * Throws ProviderResponseError when the output is not even shaped like an
 * analysis (callers may re-prompt once).
 */
export function normalizeVisionOutput(raw: unknown, provider: string): VehicleAnalysis {
  const parsed = visionCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderResponseError(provider, `Output is not a vehicle analysis: ${parsed.error.issues[0]?.message}`);
  }
  const c = parsed.data;
  const field = <T>(f: (typeof c)['make'], coerce: (v: unknown) => T | null): Tagged<T> =>
    applyPolicy(coerce(f?.value), f?.source, f?.confidence);

  const subject = oneOf(PHOTO_SUBJECTS.map((s) => s.replace(/_/g, '-')), c.subject)?.replace(/-/g, '_') as
    | VehicleAnalysis['subject']
    | undefined;

  const seen = new Set<string>();
  const visual_features = (c.visual_features ?? [])
    .map((f) => ({ value: text(f.value), source: f.source === 'detected' ? ('detected' as const) : ('inferred' as const) }))
    .filter((f): f is { value: string; source: 'detected' | 'inferred' } => {
      if (!f.value || seen.has(f.value.toLowerCase())) return false;
      seen.add(f.value.toLowerCase());
      return true;
    })
    .slice(0, VISION_POLICY.maxFeatures);

  const base = {
    subject: subject ?? 'unclear',
    image_quality: [...new Set((c.image_quality ?? []).map((q) => oneOf(IMAGE_QUALITY_ISSUES, q)).filter((q) => q !== null))],
    make: field(c.make, text),
    model: field(c.model, text),
    version: field(c.version, text),
    year: field(c.year, year),
    color: field(c.color, text),
    body_type: field(c.body_type, (v) => oneOf(BODY_TYPES, v)),
    estimated_segment: field(c.estimated_segment, (v) => oneOf(SEGMENTS, v)),
    visual_features,
    visible_details: (c.visible_details ?? [])
      .map(text)
      .filter((d): d is string => d !== null)
      .slice(0, VISION_POLICY.maxDetails),
    confidence: clamp01(c.confidence) ?? 0,
    provider,
  };
  const result = vehicleAnalysisSchema.safeParse({ ...base, missing_information: computeMissingInformation(base) });
  if (!result.success) {
    throw new ProviderResponseError(provider, `Normalized output failed validation: ${result.error.issues[0]?.message}`);
  }
  return result.data;
}
