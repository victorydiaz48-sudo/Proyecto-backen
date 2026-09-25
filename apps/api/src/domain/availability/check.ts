// Validación de una franja concreta (profesional + servicio + inicio). Función pura: recibe los datos
// ya cargados y no toca la BD, así se prueba exhaustivamente sin PostgreSQL (docs/ARCHITECTURE.md §5).
import { addDays, localDateOf, overlaps, workingRanges, type WeeklyInterval, type WorkingRange } from '../../lib/time.ts';

/** Motivos de rechazo, en el orden en que se comprueban. */
export const SLOT_REASONS = [
  'PROFESSIONAL_NOT_FOUND',
  'PROFESSIONAL_INACTIVE',
  'SERVICE_NOT_FOUND',
  'PROFESSIONAL_DOES_NOT_OFFER_SERVICE',
  'NOT_WORKING_THAT_DAY',
  'OUTSIDE_WORKING_HOURS',
  'EXCEEDS_CLOSING_TIME',
  'OVERLAPS_BOOKING',
  'OVERLAPS_TIME_BLOCK',
  'IN_THE_PAST',
  'TOO_SOON',
  'BEYOND_HORIZON',
] as const;
export type SlotReason = (typeof SLOT_REASONS)[number];

/** Motivos que dependen de la ocupación (el hueco existe pero está tomado) y no de las reglas. */
export const OCCUPANCY_REASONS: ReadonlySet<SlotReason> = new Set(['OVERLAPS_BOOKING', 'OVERLAPS_TIME_BLOCK']);

export interface SlotBlock {
  start: Date;
  end: Date;
  professionalId: string | null;
  locationId: string | null;
}

export interface SlotCheckInput {
  timezone: string;
  now: Date;
  professional: { id: string; active: boolean; serviceIds: readonly string[] } | null;
  service: { id: string; active: boolean; durationMinutes: number; bufferAfterMinutes: number } | null;
  /** Horario semanal del profesional (todas sus filas de WorkingHour). */
  workingIntervals: readonly WeeklyInterval[];
  /** Bloqueos del tenant que pueden afectar (se filtran aquí por profesional y local). */
  blocks: readonly SlotBlock[];
  /** Citas activas del profesional (sin la propia cita, si se está reprogramando). */
  bookings: readonly { start: Date; end: Date }[];
  startAt: Date;
  /** Si se indica, la cita debe caer en un horario de ese local. */
  locationId?: string | null;
  /** Antelación mínima (la web pública usa la del tenant; el panel, 0). */
  leadMinutes: number;
  /** Horizonte máximo en días desde hoy; null = sin límite (panel). */
  horizonDays: number | null;
}

export type SlotCheckResult =
  | { ok: true; startAt: Date; endAt: Date; locationId: string }
  | { ok: false; reason: SlotReason };

const MINUTE = 60_000;

export function checkSlot(input: SlotCheckInput): SlotCheckResult {
  const fail = (reason: SlotReason): SlotCheckResult => ({ ok: false, reason });
  const { professional: pro, service, timezone: tz, startAt } = input;

  if (!pro) return fail('PROFESSIONAL_NOT_FOUND');
  if (!pro.active) return fail('PROFESSIONAL_INACTIVE');
  if (!service || !service.active) return fail('SERVICE_NOT_FOUND');
  if (!pro.serviceIds.includes(service.id)) return fail('PROFESSIONAL_DOES_NOT_OFFER_SERVICE');

  // La cita ocupa la duración más el tiempo de limpieza posterior.
  const endAt = new Date(startAt.getTime() + (service.durationMinutes + service.bufferAfterMinutes) * MINUTE);

  const day = localDateOf(startAt, tz);
  // Desde el día anterior: un tramo que empieza antes de medianoche puede cubrir el inicio.
  const ranges = workingRanges([...input.workingIntervals], addDays(day, -1), localDateOf(endAt, tz), tz).filter(
    (r) => !input.locationId || r.locationId === input.locationId,
  );
  const touchesDay = (r: WorkingRange) => localDateOf(r.start, tz) === day || localDateOf(new Date(r.end.getTime() - 1), tz) === day;
  if (!ranges.some(touchesDay)) return fail('NOT_WORKING_THAT_DAY');

  const container = ranges.find((r) => r.start <= startAt && startAt < r.end);
  if (!container) return fail('OUTSIDE_WORKING_HOURS');
  if (endAt > container.end) return fail('EXCEEDS_CLOSING_TIME');

  if (input.bookings.some((b) => overlaps(startAt, endAt, b.start, b.end))) return fail('OVERLAPS_BOOKING');
  const blocked = input.blocks.some(
    (b) =>
      (b.professionalId === null || b.professionalId === pro.id) &&
      (b.locationId === null || b.locationId === container.locationId) &&
      overlaps(startAt, endAt, b.start, b.end),
  );
  if (blocked) return fail('OVERLAPS_TIME_BLOCK');

  const now = input.now.getTime();
  if (startAt.getTime() < now) return fail('IN_THE_PAST');
  if (startAt.getTime() < now + input.leadMinutes * MINUTE) return fail('TOO_SOON');
  if (input.horizonDays !== null && day > addDays(localDateOf(input.now, tz), input.horizonDays)) return fail('BEYOND_HORIZON');

  return { ok: true, startAt, endAt, locationId: container.locationId };
}
