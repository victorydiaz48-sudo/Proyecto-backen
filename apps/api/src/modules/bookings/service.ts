import { PgErrorCode, pgErrorCode, type Db, type Tx } from '../../db.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { BookingSource, BookingStatus, Role } from '../../generated/prisma/enums.ts';
import { AppError, conflict, forbidden, notFound, validationError } from '../../lib/errors.ts';
import { localToInstant, parseClock } from '../../lib/time.ts';
import { writeAudit, type Actor } from '../audit/audit.ts';
import { AvailabilityService } from '../availability/service.ts';
import { findOrCreateCustomer, normalizePhoneOrThrow } from '../customers/service.ts';
import { lockProfessionals } from '../schedule/locks.ts';
import { BOOKING_INCLUDE, toBookingDto, type BookingDto } from './dto.ts';
import { evaluateSlot, localSlotToInstant, REASONS_WITH_ALTERNATIVES, slotError, type TenantRules } from './slots.ts';

const ACTIVE: BookingStatus[] = ['PENDING', 'CONFIRMED'];
const DAY_MS = 86_400_000;

/**
 * Transiciones de estado permitidas (docs/API.md). `adminOnly`: solo un ADMIN puede hacerlas.
 * COMPLETED y NO_SHOW solo cuando la cita ya empezó.
 */
const TRANSITIONS: Record<BookingStatus, Partial<Record<BookingStatus, { adminOnly?: boolean }>>> = {
  PENDING: { CONFIRMED: {}, CANCELLED: {} },
  CONFIRMED: { COMPLETED: {}, CANCELLED: {}, NO_SHOW: {} },
  CANCELLED: { CONFIRMED: { adminOnly: true } },
  COMPLETED: { NO_SHOW: { adminOnly: true } },
  NO_SHOW: { COMPLETED: { adminOnly: true } },
};

type TenantRow = TenantRules & { currency: string; defaultCountryCode: string; defaultBookingStatus: BookingStatus };

export interface Viewer {
  role: Role;
  /** Si es PROFESSIONAL: su ficha. Solo ve y toca citas de esa ficha. */
  professionalId: string | null;
}

export interface CreateBookingInput {
  serviceId: string;
  professionalId: string;
  date: string;
  time: string;
  locationId?: string | null | undefined;
  customerId?: string | undefined;
  customer?: { name: string; phone: string; email?: string | null | undefined } | undefined;
  notes?: string | undefined;
  status?: 'PENDING' | 'CONFIRMED' | undefined;
}

export class BookingsService {
  private readonly availability: AvailabilityService;

  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
  ) {
    this.availability = new AvailabilityService(db, now);
  }

  async list(
    tenantId: string,
    viewer: Viewer,
    q: { from?: Date | undefined; to?: Date | undefined; professionalId?: string | undefined; locationId?: string | undefined; customerId?: string | undefined; status?: BookingStatus[] | undefined },
  ): Promise<BookingDto[]> {
    const tenant = await this.tenant(this.db, tenantId);
    const from = q.from ?? new Date(this.now().getTime() - DAY_MS);
    const to = q.to ?? new Date(from.getTime() + 8 * DAY_MS);
    if (to <= from || to.getTime() - from.getTime() > 92 * DAY_MS) {
      throw validationError([{ path: 'querystring.to', message: 'Rango inválido (máximo 92 días).' }]);
    }
    const scope = this.scope(viewer);
    if (scope === null) return [];
    const rows = await this.db.booking.findMany({
      where: {
        tenantId,
        startAt: { lt: to },
        endAt: { gt: from },
        ...(q.professionalId ? { professionalId: q.professionalId } : {}),
        ...(scope ? { professionalId: scope } : {}),
        ...(q.locationId ? { locationId: q.locationId } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.status ? { status: { in: q.status } } : {}),
      },
      include: BOOKING_INCLUDE,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      take: 2000,
    });
    // Si un PROFESSIONAL filtra por otro profesional, los dos filtros se combinan y no ve nada ajeno.
    return rows.filter((r) => !q.professionalId || r.professionalId === q.professionalId).map((r) => toBookingDto(r, tenant.timezone));
  }

  async get(tenantId: string, viewer: Viewer, id: string): Promise<BookingDto> {
    const tenant = await this.tenant(this.db, tenantId);
    return toBookingDto(await this.find(this.db, tenantId, viewer, id), tenant.timezone);
  }

  /** Crea una cita desde el panel. Precio, duración, fin, local y estado se deciden aquí, nunca en el cliente. */
  async create(actor: Actor, viewer: Viewer, input: CreateBookingInput): Promise<BookingDto> {
    if (viewer.role !== 'ADMIN' && viewer.professionalId !== input.professionalId) throw forbidden();
    const tenant = await this.tenant(this.db, actor.tenantId);
    const phoneE164 = input.customer ? normalizePhoneOrThrow(input.customer.phone, tenant.defaultCountryCode, 'body.customer.phone') : null;
    const alt = { serviceId: input.serviceId, professionalId: input.professionalId, date: input.date, time: input.time, locationId: input.locationId };
    const startAt = await this.withAlternatives(tenant, alt, async () => localSlotToInstant(input.date, input.time, tenant.timezone));

    return this.withAlternatives(tenant, alt, () =>
      this.db.$transaction(async (tx) => {
        await lockProfessionals(tx, tenant.id, [input.professionalId]);
        const slot = await evaluateSlot(tx, tenant, {
          professionalId: input.professionalId,
          serviceId: input.serviceId,
          startAt,
          locationId: input.locationId,
          publicRules: false,
          now: this.now(),
        });
        if (!slot.ok) throw slotError(slot.reason);

        const customerId = input.customerId
          ? await this.ensureCustomer(tx, tenant.id, input.customerId)
          : (await findOrCreateCustomer(tx, tenant.id, { name: input.customer!.name, phoneE164: phoneE164!, email: input.customer!.email ?? null })).id;
        const service = await tx.service.findFirstOrThrow({ where: { tenantId: tenant.id, id: input.serviceId } });

        const booking = await tx.booking.create({
          data: {
            tenantId: tenant.id,
            locationId: slot.locationId,
            professionalId: input.professionalId,
            serviceId: service.id,
            customerId,
            startAt: slot.startAt,
            endAt: slot.endAt,
            status: input.status ?? tenant.defaultBookingStatus,
            serviceNameSnapshot: service.name,
            priceCentsSnapshot: service.priceCents,
            durationMinutesSnapshot: service.durationMinutes,
            currencySnapshot: tenant.currency,
            customerNotes: input.notes || null,
            source: (viewer.role === 'ADMIN' ? 'ADMIN' : 'PROFESSIONAL') satisfies BookingSource,
            createdByUserId: actor.actorUserId ?? null,
          },
          include: BOOKING_INCLUDE,
        });
        const dto = toBookingDto(booking, tenant.timezone);
        await writeAudit(tx, { ...actor, action: 'booking.created', entityType: 'Booking', entityId: booking.id, after: auditView(dto) });
        return dto;
      }),
    );
  }

  /** Mueve una cita activa a otra fecha/hora (y opcionalmente profesional, servicio o local). */
  async reschedule(
    actor: Actor,
    viewer: Viewer,
    id: string,
    input: { date: string; time: string; professionalId?: string | undefined; serviceId?: string | undefined; locationId?: string | null | undefined },
  ): Promise<BookingDto> {
    const tenant = await this.tenant(this.db, actor.tenantId);
    const current0 = await this.find(this.db, tenant.id, viewer, id);
    const alt = {
      serviceId: input.serviceId ?? current0.serviceId,
      professionalId: input.professionalId ?? current0.professionalId,
      date: input.date,
      time: input.time,
      locationId: input.locationId,
    };
    const startAt = await this.withAlternatives(tenant, alt, async () => localSlotToInstant(input.date, input.time, tenant.timezone));
    return this.withAlternatives(tenant, alt, () =>
      this.db.$transaction(async (tx) => {
        const current = await this.find(tx, tenant.id, viewer, id);
        if (!ACTIVE.includes(current.status)) throw conflict('Solo se pueden mover citas pendientes o confirmadas.');
        const professionalId = input.professionalId ?? current.professionalId;
        if (viewer.role !== 'ADMIN' && professionalId !== viewer.professionalId) throw forbidden();
        const serviceId = input.serviceId ?? current.serviceId;
        const sameService = serviceId === current.serviceId;

        await lockProfessionals(tx, tenant.id, [...new Set([current.professionalId, professionalId])]);
        const slot = await evaluateSlot(tx, tenant, {
          professionalId,
          serviceId,
          startAt,
          locationId: input.locationId,
          excludeBookingId: id,
          ...(sameService ? { serviceOverride: { durationMinutes: current.durationMinutesSnapshot } } : {}),
          publicRules: false,
          now: this.now(),
        });
        if (!slot.ok) throw slotError(slot.reason);

        const data: Prisma.BookingUncheckedUpdateInput = { professionalId, locationId: slot.locationId, startAt: slot.startAt, endAt: slot.endAt };
        if (!sameService) {
          // Cambiar de servicio es una cita distinta: nuevo precio y duración vigentes.
          const service = await tx.service.findFirstOrThrow({ where: { tenantId: tenant.id, id: serviceId } });
          Object.assign(data, {
            serviceId,
            serviceNameSnapshot: service.name,
            priceCentsSnapshot: service.priceCents,
            durationMinutesSnapshot: service.durationMinutes,
            currencySnapshot: tenant.currency,
          });
        }
        const before = toBookingDto(current, tenant.timezone);
        const updated = await tx.booking.update({ where: { tenantId_id: { tenantId: tenant.id, id } }, data, include: BOOKING_INCLUDE });
        const after = toBookingDto(updated, tenant.timezone);
        await writeAudit(tx, { ...actor, action: 'booking.rescheduled', entityType: 'Booking', entityId: id, before: auditView(before), after: auditView(after) });
        return after;
      }),
    );
  }

  async changeStatus(actor: Actor, viewer: Viewer, id: string, status: BookingStatus, reason?: string): Promise<BookingDto> {
    const tenant = await this.tenant(this.db, actor.tenantId);
    return this.mapExclusion(() =>
      this.db.$transaction(async (tx) => {
        const current = await this.find(tx, tenant.id, viewer, id);
        const rule = TRANSITIONS[current.status][status];
        if (!rule) throw conflict(`No se puede pasar de ${current.status} a ${status}.`, { from: current.status, to: status });
        if (rule.adminOnly && viewer.role !== 'ADMIN') throw forbidden();
        if ((status === 'COMPLETED' || status === 'NO_SHOW') && current.startAt > this.now()) {
          throw conflict('La cita todavía no ha empezado.');
        }
        if (current.status === 'CANCELLED' && ACTIVE.includes(status)) {
          // Reactivar: el hueco puede haberse ocupado o haber cambiado el horario desde la cancelación.
          await lockProfessionals(tx, tenant.id, [current.professionalId]);
          const slot = await evaluateSlot(tx, tenant, {
            professionalId: current.professionalId,
            serviceId: current.serviceId,
            startAt: current.startAt,
            locationId: current.locationId,
            excludeBookingId: id,
            serviceOverride: { durationMinutes: current.durationMinutesSnapshot },
            publicRules: false,
            now: this.now(),
          });
          if (!slot.ok) throw slotError(slot.reason);
        }
        const updated = await tx.booking.update({
          where: { tenantId_id: { tenantId: tenant.id, id } },
          data:
            status === 'CANCELLED'
              ? { status, cancelledAt: this.now(), cancelReason: reason || null }
              : { status, cancelledAt: null, cancelReason: null },
          include: BOOKING_INCLUDE,
        });
        await writeAudit(tx, {
          ...actor,
          action: 'booking.status_changed',
          entityType: 'Booking',
          entityId: id,
          before: { status: current.status },
          after: { status, ...(reason ? { reason } : {}) },
        });
        return toBookingDto(updated, tenant.timezone);
      }),
    );
  }

  /** undefined = ve todo (ADMIN); null = no ve nada (PROFESSIONAL sin ficha); id = solo las de ese profesional. */
  private scope(viewer: Viewer): string | null | undefined {
    if (viewer.role === 'ADMIN') return undefined;
    return viewer.professionalId;
  }

  private async find(db: Db | Tx, tenantId: string, viewer: Viewer, id: string) {
    const scope = this.scope(viewer);
    if (scope === null) throw notFound();
    const row = await db.booking.findFirst({
      where: { tenantId, id, ...(scope ? { professionalId: scope } : {}) },
      include: BOOKING_INCLUDE,
    });
    if (!row) throw notFound();
    return row;
  }

  private async ensureCustomer(tx: Tx, tenantId: string, customerId: string): Promise<string> {
    const c = await tx.customer.findFirst({ where: { tenantId, id: customerId }, select: { id: true } });
    if (!c) throw validationError([{ path: 'body.customerId', message: 'Cliente no encontrado.' }]);
    return c.id;
  }

  private tenant(db: Db | Tx, tenantId: string): Promise<TenantRow> {
    return db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, timezone: true, bookingLeadMinutes: true, bookingHorizonDays: true, currency: true, defaultCountryCode: true, defaultBookingStatus: true },
    });
  }

  /**
   * Ejecuta `fn` y, si falla por la franja (hora ocupada, fuera de horario…), añade al error
   * `details.alternatives`: huecos reales cercanos del mismo servicio y profesional. Nunca reserva otra hora.
   */
  private async withAlternatives<T>(
    tenant: TenantRow,
    q: { serviceId: string; professionalId: string; date: string; time: string; locationId?: string | null | undefined },
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.mapExclusion(fn);
    } catch (err) {
      const reason = err instanceof AppError ? err.details?.reason : undefined;
      if (!(err instanceof AppError) || typeof reason !== 'string' || !REASONS_WITH_ALTERNATIVES.has(reason)) throw err;
      // Para una hora inexistente por DST, se busca alrededor de la misma hora ya normalizada.
      const requested = localToInstant(q.date, parseClock(q.time)!, tenant.timezone);
      const alternatives = await this.availability.alternatives(
        tenant.id,
        { serviceId: q.serviceId, professionalId: q.professionalId, requested, locationId: q.locationId },
        { publicRules: false },
      );
      throw new AppError(err.statusCode, err.code, err.message, { ...err.details, alternatives });
    }
  }

  /** Última red de seguridad: si el exclusion constraint salta, es un hueco ocupado (409), no un 500. */
  private async mapExclusion<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (pgErrorCode(err) === PgErrorCode.EXCLUSION_VIOLATION) throw slotError('OVERLAPS_BOOKING');
      throw err;
    }
  }
}

/** Lo que se guarda en la auditoría de una cita (sin teléfono del cliente). */
function auditView(b: BookingDto): Prisma.InputJsonValue {
  return {
    status: b.status,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    professionalId: b.professional.id,
    locationId: b.location.id,
    serviceId: b.service.id,
    priceCents: b.priceCents,
    durationMinutes: b.service.durationMinutes,
    customerId: b.customer.id,
  };
}
