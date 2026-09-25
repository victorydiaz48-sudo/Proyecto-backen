import { z } from 'zod';

/** Units a provider call can consume. Money per unit comes from configuration. */
export const UNIT_TYPES = [
  'request',
  'image',
  'megapixel',
  'second',
  '1k_input_tokens',
  '1k_output_tokens',
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/**
 * Per-provider pricing, stored in APIProvider.costConfig and editable from the
 * dashboard. costMicros is micro-USD per unit.
 */
export const costConfigSchema = z.array(
  z.object({
    unitType: z.enum(UNIT_TYPES),
    costMicros: z.number().nonnegative(),
  }),
);
export type CostConfig = z.infer<typeof costConfigSchema>;
