import { z } from 'zod';
import { parseClock } from '../../lib/time.ts';

const clock = (allowEndOfDay: boolean) =>
  z
    .string()
    .refine((s) => parseClock(s, allowEndOfDay) !== null, allowEndOfDay ? 'Formato HH:MM (00:00–24:00).' : 'Formato HH:MM (00:00–23:59).')
    .transform((s) => parseClock(s, allowEndOfDay)!);

/** Un intervalo semanal: día (0 = domingo) y horas locales del negocio. No cruza medianoche: se parte en dos. */
export const WorkingInterval = z
  .object({
    locationId: z.uuid('Identificador inválido.'),
    weekday: z.number().int().min(0).max(6),
    start: clock(false),
    end: clock(true),
  })
  .strict()
  .refine((i) => i.start < i.end, { message: 'La hora de fin debe ser posterior a la de inicio.', path: ['end'] });

export const WorkingHoursPut = z.object({ intervals: z.array(WorkingInterval).max(70) }).strict();

const instant = z.iso.datetime({ offset: true, message: 'Fecha-hora ISO 8601 con zona, p. ej. 2026-10-01T09:00:00-03:00.' }).transform((s) => new Date(s));

export const MAX_BLOCK_DAYS = 366;

const bothDates = (b: { startAt: unknown; endAt: unknown }): boolean => b.startAt instanceof Date && b.endAt instanceof Date;

export const TimeBlockCreate = z
  .object({
    /** null = todos los profesionales (del local indicado o de todo el negocio). Omitido para un PROFESSIONAL = él mismo. */
    professionalId: z.uuid().nullable().optional(),
    locationId: z.uuid().nullable().optional(),
    startAt: instant,
    endAt: instant,
    reason: z.string().trim().max(200).optional(),
  })
  .strict()
  // Zod 4 ejecuta los refine del objeto aunque un campo ya haya fallado: si las fechas no se
  // convirtieron a Date, el error ya está reportado en su campo y aquí no se añade nada.
  .refine((b) => !bothDates(b) || b.startAt < b.endAt, { message: 'El fin debe ser posterior al inicio.', path: ['endAt'] })
  .refine((b) => !bothDates(b) || b.endAt.getTime() - b.startAt.getTime() <= MAX_BLOCK_DAYS * 86_400_000, {
    message: `Un bloqueo no puede durar más de ${MAX_BLOCK_DAYS} días.`,
    path: ['endAt'],
  });

export const TimeBlockListQuery = z
  .object({
    from: instant.optional(),
    to: instant.optional(),
    professionalId: z.uuid().optional(),
    locationId: z.uuid().optional(),
  })
  .strict();
