import {
  ANALYSIS_FIELDS,
  FIELD_SOURCES,
  costConfigSchema,
  qaReportSchema,
  videoPlanSchema,
} from '@autocontent/shared';
import { z } from 'zod';

/**
 * Schemas for every Json column. Json columns are always written through
 * these (repositories call .parse) so malformed data never reaches the DB.
 */

/** Vehicle.provenance: where each identity field came from. */
export const provenanceSchema = z.partialRecord(
  z.enum(ANALYSIS_FIELDS),
  z.object({ source: z.enum(FIELD_SOURCES), confidence: z.number().min(0).max(1).optional() }),
);

/** Vehicle.visualFeatures */
export const visualFeaturesSchema = z.array(
  z.object({ value: z.string().min(1), source: z.enum(['detected', 'inferred']) }),
);

/** APIProvider.config: non-secret adapter settings. Secrets are rejected by key name. */
export const providerConfigSchema = z
  .record(z.string(), z.unknown())
  .refine((c) => !Object.keys(c).some((k) => /key|secret|token|password/i.test(k)), {
    message: 'Secrets do not belong in provider config; use APIKeyReference',
  });

export { costConfigSchema, qaReportSchema, videoPlanSchema };
