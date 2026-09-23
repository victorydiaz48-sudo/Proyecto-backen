import { z } from 'zod';
import { zOptionalText } from '../../lib/validation.ts';

const fields = {
  name: z.string().trim().min(1).max(80),
  description: zOptionalText(200),
  category: zOptionalText(40),
  durationMinutes: z.number().int().min(5).max(600),
  bufferAfterMinutes: z.number().int().min(0).max(120),
  /** Céntimos: R$ 45,00 → 4500. */
  priceCents: z.number().int().min(0).max(100_000_000),
  sortOrder: z.number().int().min(0).max(10_000),
};

export const ServiceCreate = z
  .object({
    ...fields,
    description: fields.description.optional(),
    category: fields.category.optional(),
    bufferAfterMinutes: fields.bufferAfterMinutes.default(0),
    sortOrder: fields.sortOrder.default(0),
  })
  .strict();

export const ServicePatch = z
  .object({ ...fields, active: z.boolean() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Indica al menos un campo.');

export const ServiceListQuery = z.object({ includeInactive: z.stringbool().default(false) }).strict();

export const SERVICE_SELECT = {
  id: true,
  name: true,
  description: true,
  category: true,
  durationMinutes: true,
  bufferAfterMinutes: true,
  priceCents: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;
