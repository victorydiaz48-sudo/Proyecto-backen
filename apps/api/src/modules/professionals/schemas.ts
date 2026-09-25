import { z } from 'zod';
import { zHttpsUrl, zOptionalText } from '../../lib/validation.ts';

const fields = {
  displayName: z.string().trim().min(1).max(80),
  title: zOptionalText(80),
  bio: zOptionalText(400),
  photoUrl: zHttpsUrl.nullable(),
  sortOrder: z.number().int().min(0).max(10_000),
};

const serviceIds = z.array(z.uuid('Identificador inválido.')).max(200);

export const ProfessionalCreate = z
  .object({
    displayName: fields.displayName,
    title: fields.title.optional(),
    bio: fields.bio.optional(),
    photoUrl: fields.photoUrl.optional(),
    sortOrder: fields.sortOrder.default(0),
    serviceIds: serviceIds.default([]),
  })
  .strict();

export const ProfessionalPatch = z
  .object({ ...fields, active: z.boolean() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Indica al menos un campo.');

export const ProfessionalServicesPut = z.object({ serviceIds }).strict();

export const ProfessionalListQuery = z
  .object({ includeInactive: z.stringbool().default(false), serviceId: z.uuid().optional() })
  .strict();

export const PROFESSIONAL_SELECT = {
  id: true,
  displayName: true,
  title: true,
  bio: true,
  photoUrl: true,
  active: true,
  sortOrder: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  services: { select: { serviceId: true }, orderBy: { serviceId: 'asc' } },
} as const;
