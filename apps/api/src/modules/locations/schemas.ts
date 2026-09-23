import { z } from 'zod';
import { zHttpsUrl, zOptionalText } from '../../lib/validation.ts';

const fields = {
  name: z.string().trim().min(1).max(40),
  address: zOptionalText(200),
  mapsUrl: zHttpsUrl.nullable(),
  /** Se normaliza a E.164 con el código de país del negocio. */
  whatsapp: zOptionalText(40),
  sortOrder: z.number().int().min(0).max(10_000),
  isDefault: z.boolean(),
};

export const LocationCreate = z
  .object({
    name: fields.name,
    address: fields.address.optional(),
    mapsUrl: fields.mapsUrl.optional(),
    whatsapp: fields.whatsapp.optional(),
    sortOrder: fields.sortOrder.default(0),
    isDefault: fields.isDefault.default(false),
  })
  .strict();

export const LocationPatch = z
  .object({ ...fields, active: z.boolean() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Indica al menos un campo.');

export const LocationListQuery = z.object({ includeInactive: z.stringbool().default(false) }).strict();

export const LOCATION_SELECT = {
  id: true,
  name: true,
  address: true,
  mapsUrl: true,
  whatsapp: true,
  isDefault: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;
