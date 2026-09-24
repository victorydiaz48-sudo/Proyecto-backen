import type { Db, Tx } from '../../db.ts';
import { computeSlots, findAlternatives, type DaySlots, type Slot } from '../../domain/availability/slots.ts';
import { AppError, notFound, validationError } from '../../lib/errors.ts';
import { addDays, localDateOf } from '../../lib/time.ts';

const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 14;
/** Días que se exploran hacia delante para completar alternativas. */
const ALTERNATIVE_LOOKAHEAD_DAYS = 7;

export interface AvailabilityQuery {
  serviceId: string;
  /** Un profesional concreto o 'any' ("sin preferencia"). */
  professionalId: string;
  fromDate: string;
  toDate: string;
  locationId?: string | null | undefined;
}

export interface SlotDto {
  startAt: Date;
  localTime: string;
  locationId: string;
  professionalIds: string[];
}

const toSlotDto = (s: Slot): SlotDto => ({ startAt: s.startAt, localTime: s.localTime, locationId: s.locationId, professionalIds: s.professionalIds });
export const toAlternativeDto = (s: Slot) => ({ startAt: s.startAt, localDate: s.localDate, localTime: s.localTime, locationId: s.locationId, professionalIds: s.professionalIds });

/**
 * Adaptador del motor de disponibilidad: carga de la BD (siempre filtrando por tenant) lo que necesita
 * computeSlots(). `publicRules`: antelación mínima y horizonte del negocio (web pública); el panel no
 * los aplica, pero nunca ofrece huecos en el pasado.
 */
export class AvailabilityService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
  ) {}

  async compute(tenantId: string, q: AvailabilityQuery, opts: { publicRules: boolean }, db: Db | Tx = this.db) {
    if (q.toDate < q.fromDate || addDays(q.fromDate, MAX_RANGE_DAYS - 1) < q.toDate) {
      throw validationError([{ path: 'querystring.to', message: `Rango inválido (máximo ${MAX_RANGE_DAYS} días).` }]);
    }
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { timezone: true, slotIntervalMinutes: true, bookingLeadMinutes: true, bookingHorizonDays: true },
    });
    const service = await db.service.findFirst({
      where: { tenantId, id: q.serviceId, active: true },
      select: { id: true, durationMinutes: true, bufferAfterMinutes: true },
    });
    if (!service) throw notFound();

    const pros = await db.professional.findMany({
      where: {
        tenantId,
        active: true,
        services: { some: { serviceId: service.id } },
        ...(q.professionalId === 'any' ? {} : { id: q.professionalId }),
      },
      select: { id: true, sortOrder: true },
    });
    if (q.professionalId !== 'any' && pros.length === 0) {
      // Mismo resultado para inexistente, de otro negocio, inactivo o que no hace el servicio.
      throw new AppError(404, 'NOT_FOUND', 'Ese profesional no está disponible para este servicio.');
    }
    const ids = pros.map((p) => p.id);
    const windowStart = new Date(Date.parse(`${q.fromDate}T00:00:00Z`) - 2 * DAY_MS);
    const windowEnd = new Date(Date.parse(`${q.toDate}T00:00:00Z`) + 3 * DAY_MS);
    const [hours, bookings, blocks] = await Promise.all([
      db.workingHour.findMany({ where: { tenantId, professionalId: { in: ids } }, select: { professionalId: true, weekday: true, startMinute: true, endMinute: true, locationId: true } }),
      db.booking.findMany({
        where: { tenantId, professionalId: { in: ids }, status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { lt: windowEnd }, endAt: { gt: windowStart } },
        select: { professionalId: true, startAt: true, endAt: true },
      }),
      db.timeBlock.findMany({
        where: { tenantId, startAt: { lt: windowEnd }, endAt: { gt: windowStart }, OR: [{ professionalId: null }, { professionalId: { in: ids } }] },
        select: { startAt: true, endAt: true, professionalId: true, locationId: true },
      }),
    ]);

    const days: DaySlots[] = computeSlots({
      timezone: tenant.timezone,
      now: this.now(),
      slotIntervalMinutes: tenant.slotIntervalMinutes,
      leadMinutes: opts.publicRules ? tenant.bookingLeadMinutes : 0,
      horizonDays: opts.publicRules ? tenant.bookingHorizonDays : null,
      occupiedMinutes: service.durationMinutes + service.bufferAfterMinutes,
      candidates: pros.map((p) => ({
        id: p.id,
        sortOrder: p.sortOrder,
        workingIntervals: hours.filter((h) => h.professionalId === p.id),
        bookings: bookings.filter((b) => b.professionalId === p.id).map((b) => ({ start: b.startAt, end: b.endAt })),
      })),
      blocks: blocks.map((b) => ({ start: b.startAt, end: b.endAt, professionalId: b.professionalId, locationId: b.locationId })),
      fromDate: q.fromDate,
      toDate: q.toDate,
      locationId: q.locationId ?? null,
    });
    return { timezone: tenant.timezone, service, days };
  }

  /** Respuesta del endpoint de disponibilidad (panel y web pública). */
  async availability(tenantId: string, q: AvailabilityQuery, opts: { publicRules: boolean }) {
    const { timezone, service, days } = await this.compute(tenantId, q, opts);
    return {
      timezone,
      serviceId: service.id,
      durationMinutes: service.durationMinutes,
      days: days.map((d) => ({ date: d.date, slots: d.slots.map(toSlotDto) })),
    };
  }

  /**
   * Alternativas reales a una hora que no se pudo reservar. Nunca lanza: si algo impide calcularlas
   * (servicio o profesional inválido), devuelve una lista vacía y el error original se mantiene.
   */
  async alternatives(
    tenantId: string,
    q: { serviceId: string; professionalId: string; requested: Date; locationId?: string | null | undefined },
    opts: { publicRules: boolean },
  ) {
    try {
      const tz = (await this.db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } })).timezone;
      const requestedDate = localDateOf(q.requested, tz);
      const today = localDateOf(this.now(), tz);
      const fromDate = requestedDate < today ? today : requestedDate;
      const { days } = await this.compute(
        tenantId,
        { serviceId: q.serviceId, professionalId: q.professionalId, fromDate, toDate: addDays(fromDate, ALTERNATIVE_LOOKAHEAD_DAYS - 1), locationId: q.locationId },
        opts,
      );
      return findAlternatives(days, q.requested, requestedDate).map(toAlternativeDto);
    } catch {
      return [];
    }
  }
}
