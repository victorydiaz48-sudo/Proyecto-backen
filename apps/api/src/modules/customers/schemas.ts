import { z } from 'zod';
import { zOptionalText } from '../../lib/validation.ts';

export const zCustomerName = z.string().trim().min(1).max(80);
/** Teléfono tal como lo escribe una persona; el servidor lo normaliza a E.164 con el país del negocio. */
export const zPhoneInput = z.string().trim().min(1).max(40);
export const zOptionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .transform((s) => (s === '' ? null : s))
  .pipe(z.email('Email inválido.').nullable())
  .nullable();

export const CustomerCreate = z
  .object({
    name: zCustomerName,
    phone: zPhoneInput,
    email: zOptionalEmail.optional(),
    notes: zOptionalText(500).optional(),
  })
  .strict();

export const CustomerPatch = z
  .object({ name: zCustomerName, phone: zPhoneInput, email: zOptionalEmail, notes: zOptionalText(500) })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Indica al menos un campo.');

export const CustomerListQuery = z
  .object({
    search: z.string().trim().max(80).optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const CUSTOMER_SELECT = {
  id: true,
  name: true,
  phoneE164: true,
  email: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;
