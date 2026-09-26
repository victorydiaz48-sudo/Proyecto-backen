import { taggedSchema, FIELD_SOURCES, IMAGE_QUALITY_ISSUES } from '@autocontent/shared';
import { z } from 'zod';

/** What the photo actually shows. Anything but `vehicle` stops the job before any further spend. */
export const PHOTO_SUBJECTS = ['vehicle', 'not_vehicle', 'multiple_vehicles', 'unclear'] as const;
export type PhotoSubject = (typeof PHOTO_SUBJECTS)[number];

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

export const vehicleAnalysisSchema = z.object({
  subject: z.enum(PHOTO_SUBJECTS),
  image_quality: z.array(z.enum(IMAGE_QUALITY_ISSUES)),
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

/**
 * Recomputes `missing_information` from the actual field values so it can never
 * drift from the data. User-only fields are always missing at analysis time.
 */
export function computeMissingInformation(a: Omit<VehicleAnalysis, 'missing_information'>): MissingField[] {
  const missing: MissingField[] = ANALYSIS_FIELDS.filter((k) => a[k].source === 'unknown');
  return [...missing, ...USER_ONLY_FIELDS];
}

/** Vehicle.provenance: where each identity field came from. */
export const provenanceSchema = z.partialRecord(
  z.enum(ANALYSIS_FIELDS),
  z.object({ source: z.enum(FIELD_SOURCES), confidence: z.number().min(0).max(1).optional() }),
);

/** Vehicle.visualFeatures */
export const visualFeaturesSchema = z.array(
  z.object({ value: z.string().min(1), source: z.enum(['detected', 'inferred']) }),
);
