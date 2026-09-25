import { z } from 'zod';
import { PASSWORD_MAX } from '../../lib/password.ts';
import { zEmail } from '../../lib/validation.ts';

export const zRole = z.enum(['ADMIN', 'PROFESSIONAL']);

export const UserCreate = z
  .object({
    email: zEmail,
    role: zRole,
    /** Si se omite, el servidor genera una contraseña temporal y la devuelve una sola vez. */
    password: z.string().min(1).max(PASSWORD_MAX).optional(),
    /** Ficha de profesional a vincular (solo con role PROFESSIONAL). */
    professionalId: z.uuid().nullable().optional(),
  })
  .strict();

export const UserPatch = z
  .object({ role: zRole, active: z.boolean(), professionalId: z.uuid().nullable() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Indica al menos un campo.');

export const AuditListQuery = z
  .object({
    entityType: z.string().max(40).optional(),
    entityId: z.string().max(60).optional(),
    action: z.string().max(60).optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
