import { z } from 'zod';
import { isLocalDate, parseClock } from '../../lib/time.ts';
import { zCustomerName, zOptionalEmail, zPhoneInput } from '../customers/schemas.ts';

export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;

/** Fecha local del negocio (YYYY-MM-DD). La zona la pone el servidor, nunca el navegador. */
export const zLocalDate = z.string().refine(isLocalDate, 'Fecha YYYY-MM-DD.');
export const zLocalTime = z.string().refine((s) => parseClock(s) !== null, 'Hora HH:MM.');
const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const BookingCreate = z
  .object({
    serviceId: z.uuid(),
    /** Un profesional concreto o 'any' ("sin preferencia": lo asigna el servidor). */
    professionalId: z.union([z.uuid(), z.literal('any')]),
    date: zLocalDate,
    time: zLocalTime,
    locationId: z.uuid().nullable().optional(),
    customerId: z.uuid().optional(),
    customer: z.object({ name: zCustomerName, phone: zPhoneInput, email: zOptionalEmail.optional() }).strict().optional(),
    notes: z.string().trim().max(300).optional(),
    /** Solo el estado inicial; por defecto, el configurado en el negocio. */
    status: z.enum(['PENDING', 'CONFIRMED']).optional(),
  })
  .strict()
  .refine((b) => (b.customerId ? 1 : 0) + (b.customer ? 1 : 0) === 1, {
    message: 'Indica customerId o customer (uno de los dos).',
    path: ['customer'],
  });

export const BookingReschedule = z
  .object({
    date: zLocalDate,
    time: zLocalTime,
    professionalId: z.uuid().optional(),
    serviceId: z.uuid().optional(),
    locationId: z.uuid().nullable().optional(),
  })
  .strict();

export const BookingStatusChange = z
  .object({ status: z.enum(BOOKING_STATUSES), reason: z.string().trim().max(200).optional() })
  .strict();

export const BookingListQuery = z
  .object({
    from: instant.optional(),
    to: instant.optional(),
    professionalId: z.uuid().optional(),
    locationId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    /** Lista separada por comas: status=PENDING,CONFIRMED */
    status: z
      .string()
      .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(z.enum(BOOKING_STATUSES)).min(1))
      .optional(),
  })
  .strict();
