import { z } from 'zod';

/**
 * Where a piece of vehicle information came from. Every field in a
 * VehicleAnalysis carries one of these so downstream code (copywriting, QA)
 * can decide what is safe to publish. Nothing is ever silently invented.
 */
export const FIELD_SOURCES = ['detected', 'inferred', 'user-provided', 'unknown'] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export const BODY_TYPES = [
  'sedan',
  'hatchback',
  'suv',
  'crossover',
  'pickup',
  'coupe',
  'convertible',
  'wagon',
  'van',
  'other',
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const SEGMENTS = ['economy', 'mid-range', 'premium', 'luxury', 'sport', 'utility'] as const;
export type Segment = (typeof SEGMENTS)[number];

/** Information that can never be obtained from a photo and must come from the user. */
export const USER_ONLY_FIELDS = ['price', 'mileage', 'location', 'contact', 'financing'] as const;
export type UserOnlyField = (typeof USER_ONLY_FIELDS)[number];

export const ANALYSIS_FIELDS = ['make', 'model', 'version', 'year', 'color', 'body_type', 'estimated_segment'] as const;
export type AnalysisField = (typeof ANALYSIS_FIELDS)[number];

export type MissingField = AnalysisField | UserOnlyField;

const confidence = z.number().min(0).max(1);

/**
 * A value plus its provenance. Invariant: `unknown` <=> value is null.
 */
export function taggedSchema<T>(value: z.ZodType<T>): z.ZodType<Tagged<T>> {
  return z
    .object({
      value: value.nullable(),
      source: z.enum(FIELD_SOURCES),
      confidence: confidence.optional(),
    })
    .refine((f) => (f.source === 'unknown') === (f.value === null), {
      message: 'source must be "unknown" exactly when value is null',
    });
}

export type Tagged<T> = {
  value: T | null;
  source: FieldSource;
  /** 0..1, provider's confidence for this specific field */
  confidence?: number;
};

export const vehicleAnalysisSchema = z.object({
  make: taggedSchema(z.string().min(1)),
  model: taggedSchema(z.string().min(1)),
  version: taggedSchema(z.string().min(1)),
  year: taggedSchema(z.number().int().min(1900).max(2100)),
  color: taggedSchema(z.string().min(1)),
  body_type: taggedSchema(z.enum(BODY_TYPES)),
  estimated_segment: taggedSchema(z.enum(SEGMENTS)),
  visual_features: z.array(
    z.object({
      value: z.string().min(1),
      source: z.enum(['detected', 'inferred']),
    }),
  ),
  visible_details: z.array(z.string().min(1)),
  /** Overall confidence that the vehicle identification (make/model) is right. */
  confidence,
  missing_information: z.array(z.enum([...ANALYSIS_FIELDS, ...USER_ONLY_FIELDS])),
  /** Which provider produced this analysis, for traceability. */
  provider: z.string().min(1),
});

export type VehicleAnalysis = z.infer<typeof vehicleAnalysisSchema>;

export function unknownField<T>(): Tagged<T> {
  return { value: null, source: 'unknown' };
}

/**
 * Recomputes `missing_information` from the actual field values so it can never
 * drift from the data. User-only fields are always missing at analysis time.
 */
export function computeMissingInformation(a: Omit<VehicleAnalysis, 'missing_information'>): MissingField[] {
  const missing: MissingField[] = ANALYSIS_FIELDS.filter((k) => a[k].source === 'unknown');
  return [...missing, ...USER_ONLY_FIELDS];
}
