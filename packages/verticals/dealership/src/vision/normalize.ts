import { ProviderResponseError } from '@autocontent/shared';
import { VISION_POLICY, applyPolicy, clamp01, oneOf, text, year } from '@autocontent/providers';
import { PHOTO_SUBJECTS, IMAGE_QUALITY_ISSUES } from '@autocontent/shared';
import { z } from 'zod';
import { BODY_TYPES, SEGMENTS, computeMissingInformation, vehicleAnalysisSchema, type VehicleAnalysis } from '../entities/vehicle-analysis.js';

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
  const field = <T>(f: (typeof c)['make'], coerce: (v: unknown) => T | null) =>
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
