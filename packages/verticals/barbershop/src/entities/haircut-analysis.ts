import { taggedSchema, FIELD_SOURCES, IMAGE_QUALITY_ISSUES } from '@autocontent/shared';
import { z } from 'zod';

/** What the photo actually shows. Anything but `haircut` stops the job before any further spend. */
export const HAIRCUT_SUBJECTS = ['haircut', 'not_haircut', 'unclear'] as const;
export type HaircutSubject = (typeof HAIRCUT_SUBJECTS)[number];

export const HAIRSTYLES = ['buzz-cut', 'fade', 'afro', 'bob', 'pixie', 'undercut', 'other'] as const;
export type Hairstyle = (typeof HAIRSTYLES)[number];

/** Information that can never be obtained from a photo and must come from the user. */
export const USER_ONLY_FIELDS = ['price', 'stylistName'] as const;
export type UserOnlyField = (typeof USER_ONLY_FIELDS)[number];

export const ANALYSIS_FIELDS = ['style', 'color'] as const;
export type AnalysisField = (typeof ANALYSIS_FIELDS)[number];

export type MissingField = AnalysisField | UserOnlyField;

const confidence = z.number().min(0).max(1);

export const haircutAnalysisSchema = z.object({
  subject: z.enum(HAIRCUT_SUBJECTS),
  image_quality: z.array(z.enum(IMAGE_QUALITY_ISSUES)),
  style: taggedSchema(z.enum(HAIRSTYLES)),
  color: taggedSchema(z.string().min(1)),
  /** Overall confidence that the style identification is right. */
  confidence,
  missing_information: z.array(z.enum([...ANALYSIS_FIELDS, ...USER_ONLY_FIELDS])),
  /** Which provider produced this analysis, for traceability. */
  provider: z.string().min(1),
});

export type HaircutAnalysis = z.infer<typeof haircutAnalysisSchema>;

/**
 * Recomputes `missing_information` from the actual field values so it can never
 * drift from the data. User-only fields are always missing at analysis time.
 */
export function computeMissingInformation(a: Omit<HaircutAnalysis, 'missing_information'>): MissingField[] {
  const missing: MissingField[] = ANALYSIS_FIELDS.filter((k) => a[k].source === 'unknown');
  return [...missing, ...USER_ONLY_FIELDS];
}

/** Haircut.provenance: where each identity field came from. */
export const provenanceSchema = z.partialRecord(
  z.enum(ANALYSIS_FIELDS),
  z.object({ source: z.enum(FIELD_SOURCES), confidence: z.number().min(0).max(1).optional() }),
);
