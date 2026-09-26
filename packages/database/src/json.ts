import { costConfigSchema, qaReportSchema, videoPlanSchema } from '@autocontent/shared';
import { z } from 'zod';

/**
 * Schemas for every Json column. Json columns are always written through
 * these (repositories call .parse) so malformed data never reaches the DB.
 *
 * Vehicle.provenance/visualFeatures moved to the dealership module
 * (packages/verticals/dealership/src/entities/vehicle-analysis.ts) — Phase
 * 3b, since they depend on vehicle-specific field names.
 */

/** APIProvider.config: non-secret adapter settings. Secrets are rejected by key name. */
export const providerConfigSchema = z
  .record(z.string(), z.unknown())
  .refine((c) => !Object.keys(c).some((k) => /key|secret|token|password/i.test(k)), {
    message: 'Secrets do not belong in provider config; use APIKeyReference',
  });

export { costConfigSchema, qaReportSchema, videoPlanSchema };
