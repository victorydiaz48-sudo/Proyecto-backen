import type { Tx } from '../../db.ts';
import { checkSlot, OCCUPANCY_REASONS, type SlotCheckResult, type SlotReason } from '../../domain/availability/check.ts';
import { AppError } from '../../lib/errors.ts';
import { isAmbiguousOrMissingLocalTime, localToInstant, parseClock } from '../../lib/time.ts';

const DAY_MS = 86_400_000;

export interface TenantRules {
  id: string;
  timezone: string;
  bookingLeadMinutes: number;
  bookingHorizonDays: number;
}

/** Fecha + hora locales del negocio → instante. Rechaza horas que no existen o se repiten por DST. */
export function localSlotToInstant(date: string, time: string, timezone: string): Date {
  const minute = parseClock(time)!;
  if (isAmbiguousOrMissingLocalTime(date, minute, timezone)) {
    throw new AppError(422, 'SLOT_INVALID', 'Esa hora no existe o se repite ese día por el cambio de horario.', { reason: 'INVALID_LOCAL_TIME' });
  }
  return localToInstant(date, minute, timezone);
}

/**
 * Carga lo necesario de la BD (dentro de la transacción, con el profesional ya bloqueado) y evalúa la
 * franja con el motor puro. `publicRules`: antelación mínima y horizonte del negocio (web pública);
 * el panel solo impide reservar en el pasado.
 */
export async function evaluateSlot(
  tx: Tx,
  tenant: TenantRules,
  args: {
    professionalId: string;
    serviceId: string;
    startAt: Date;
    locationId?: string | null | undefined;
    excludeBookingId?: string;
    /** Para reprogramar sin cambiar de servicio: se respeta la duración guardada en la cita. */
    serviceOverride?: { durationMinutes: number };
    publicRules: boolean;
    now: Date;
  },
): Promise<SlotCheckResult> {
  const windowStart = new Date(args.startAt.getTime() - DAY_MS);
  const windowEnd = new Date(args.startAt.getTime() + 2 * DAY_MS);
  const [professional, service, workingIntervals, blocks, bookings] = await Promise.all([
    tx.professional.findFirst({
      where: { tenantId: tenant.id, id: args.professionalId },
      select: { id: true, active: true, services: { select: { serviceId: true } } },
    }),
    tx.service.findFirst({
      where: { tenantId: tenant.id, id: args.serviceId },
      select: { id: true, active: true, durationMinutes: true, bufferAfterMinutes: true },
    }),
    tx.workingHour.findMany({
      where: { tenantId: tenant.id, professionalId: args.professionalId },
      select: { weekday: true, startMinute: true, endMinute: true, locationId: true },
    }),
    tx.timeBlock.findMany({
      where: {
        tenantId: tenant.id,
        OR: [{ professionalId: args.professionalId }, { professionalId: null }],
        startAt: { lt: windowEnd },
        endAt: { gt: windowStart },
      },
      select: { startAt: true, endAt: true, professionalId: true, locationId: true },
    }),
    tx.booking.findMany({
      where: {
        tenantId: tenant.id,
        professionalId: args.professionalId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startAt: { lt: windowEnd },
        endAt: { gt: windowStart },
        ...(args.excludeBookingId ? { id: { not: args.excludeBookingId } } : {}),
      },
      select: { startAt: true, endAt: true },
    }),
  ]);

  return checkSlot({
    timezone: tenant.timezone,
    now: args.now,
    professional: professional && { id: professional.id, active: professional.active, serviceIds: professional.services.map((s) => s.serviceId) },
    service:
      service &&
      (args.serviceOverride
        ? { ...service, active: true, durationMinutes: args.serviceOverride.durationMinutes }
        : service),
    workingIntervals,
    blocks: blocks.map((b) => ({ start: b.startAt, end: b.endAt, professionalId: b.professionalId, locationId: b.locationId })),
    bookings: bookings.map((b) => ({ start: b.startAt, end: b.endAt })),
    startAt: args.startAt,
    locationId: args.locationId ?? null,
    leadMinutes: args.publicRules ? tenant.bookingLeadMinutes : 0,
    horizonDays: args.publicRules ? tenant.bookingHorizonDays : null,
  });
}

const MESSAGES: Record<SlotReason, string> = {
  PROFESSIONAL_NOT_FOUND: 'Profesional no encontrado.',
  PROFESSIONAL_INACTIVE: 'Ese profesional no está disponible.',
  SERVICE_NOT_FOUND: 'Servicio no encontrado.',
  PROFESSIONAL_DOES_NOT_OFFER_SERVICE: 'Ese profesional no realiza este servicio.',
  NOT_WORKING_THAT_DAY: 'El profesional no trabaja ese día.',
  OUTSIDE_WORKING_HOURS: 'Esa hora está fuera del horario de trabajo.',
  EXCEEDS_CLOSING_TIME: 'El servicio no termina antes del cierre.',
  OVERLAPS_BOOKING: 'Ese horario ya no está disponible.',
  OVERLAPS_TIME_BLOCK: 'Ese horario no está disponible.',
  IN_THE_PAST: 'Esa hora ya pasó.',
  TOO_SOON: 'Se necesita más antelación para reservar.',
  BEYOND_HORIZON: 'Todavía no se puede reservar en esa fecha.',
};

/** 409 SLOT_UNAVAILABLE si el hueco está ocupado; 422 SLOT_INVALID si la franja no es reservable. */
export function slotError(reason: SlotReason, extra: Record<string, unknown> = {}): AppError {
  const occupied = OCCUPANCY_REASONS.has(reason);
  return new AppError(occupied ? 409 : 422, occupied ? 'SLOT_UNAVAILABLE' : 'SLOT_INVALID', MESSAGES[reason], { reason, ...extra });
}
