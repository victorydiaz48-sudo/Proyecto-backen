import { z } from 'zod';

/**
 * Where a piece of information came from. Any tagged field in any vertical's
 * analysis schema carries one of these so downstream code (copywriting, QA)
 * can decide what is safe to publish. Nothing is ever silently invented.
 */
export const FIELD_SOURCES = ['detected', 'inferred', 'user-provided', 'unknown'] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export type Tagged<T> = {
  value: T | null;
  source: FieldSource;
  /** 0..1, provider's confidence for this specific field */
  confidence?: number;
};

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

export function unknownField<T>(): Tagged<T> {
  return { value: null, source: 'unknown' };
}
