import type { Db, Tx } from '../../db.ts';
import { conflict, notFound, validationError } from '../../lib/errors.ts';
import { addDays, formatClock, localDateOf, workingRanges, type WeeklyInterval } from '../../lib/time.ts';
import { writeAudit, type Actor } from '../audit/audit.ts';
import { lockProfessionals } from './locks.ts';

export interface WorkingIntervalDto {
  id: string;
  locationId: string;
  weekday: number;
  start: string;
  end: string;
}

const toDto = (w: { id: string; locationId: string; weekday: number; startMinute: number; endMinute: number }): WorkingIntervalDto => ({
  id: w.id,
  locationId: w.locationId,
  weekday: w.weekday,
  start: formatClock(w.startMinute),
  end: formatClock(w.endMinute),
});

type Input = { locationId: string; weekday: number; start: number; end: number };

/** Horario semanal de cada profesional: varios intervalos por día, cada uno en un local. */
export class WorkingHoursService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
  ) {}

  async get(tenantId: string, professionalId: string): Promise<WorkingIntervalDto[]> {
    await this.ensureProfessional(this.db, tenantId, professionalId);
    const rows = await this.db.workingHour.findMany({
      where: { tenantId, professionalId },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
    return rows.map(toDto);
  }

  /**
   * Reemplaza la semana completa. Rechaza intervalos que se solapan el mismo día (aunque sean en
   * locales distintos: nadie está en dos sitios a la vez) y cambios que dejarían fuera de horario
   * citas futuras ya aceptadas.
   */
  async replace(actor: Actor, professionalId: string, intervals: Input[]): Promise<WorkingIntervalDto[]> {
    this.checkOverlaps(intervals);
    return this.db.$transaction(async (tx) => {
      await this.ensureProfessional(tx, actor.tenantId, professionalId);
      await lockProfessionals(tx, actor.tenantId, [professionalId]);
      await this.checkLocations(tx, actor.tenantId, intervals);

      const next: WeeklyInterval[] = intervals.map((i) => ({ weekday: i.weekday, startMinute: i.start, endMinute: i.end, locationId: i.locationId }));
      await this.ensureBookingsStillFit(tx, actor.tenantId, professionalId, next);

      const before = (await tx.workingHour.findMany({ where: { tenantId: actor.tenantId, professionalId }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] })).map(toDto);
      await tx.workingHour.deleteMany({ where: { tenantId: actor.tenantId, professionalId } });
      await tx.workingHour.createMany({
        data: next.map((i) => ({ ...i, tenantId: actor.tenantId, professionalId })),
      });
      const after = (await tx.workingHour.findMany({ where: { tenantId: actor.tenantId, professionalId }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] })).map(toDto);
      const strip = (l: WorkingIntervalDto[]) => l.map(({ id: _id, ...rest }) => rest);
      await writeAudit(tx, {
        ...actor,
        action: 'professional.working_hours_updated',
        entityType: 'Professional',
        entityId: professionalId,
        before: { intervals: strip(before) },
        after: { intervals: strip(after) },
      });
      return after;
    });
  }

  private checkOverlaps(intervals: Input[]): void {
    const sorted = intervals.map((i, index) => ({ ...i, index })).sort((a, b) => a.weekday - b.weekday || a.start - b.start);
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1]!;
      const cur = sorted[k]!;
      if (prev.weekday === cur.weekday && cur.start < prev.end) {
        throw validationError([{ path: `body.intervals.${cur.index}`, message: 'Se solapa con otro intervalo del mismo día.' }]);
      }
    }
  }

  private async checkLocations(tx: Tx, tenantId: string, intervals: Input[]): Promise<void> {
    const ids = [...new Set(intervals.map((i) => i.locationId))];
    const active = new Set(
      (await tx.location.findMany({ where: { tenantId, id: { in: ids }, active: true }, select: { id: true } })).map((l) => l.id),
    );
    const bad = intervals.flatMap((i, index) => (active.has(i.locationId) ? [] : [{ path: `body.intervals.${index}.locationId`, message: 'Local no encontrado o inactivo.' }]));
    if (bad.length) throw validationError(bad);
  }

  private async ensureBookingsStillFit(tx: Tx, tenantId: string, professionalId: string, intervals: WeeklyInterval[]): Promise<void> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } });
    const bookings = await tx.booking.findMany({
      where: { tenantId, professionalId, status: { in: ['PENDING', 'CONFIRMED'] }, endAt: { gt: this.now() } },
      select: { startAt: true, endAt: true, locationId: true },
    });
    const outside = bookings.filter((b) => {
      const ranges = workingRanges(intervals, addDays(localDateOf(b.startAt, tenant.timezone), -1), localDateOf(b.endAt, tenant.timezone), tenant.timezone);
      return !ranges.some((r) => r.locationId === b.locationId && r.start <= b.startAt && b.endAt <= r.end);
    });
    if (outside.length) {
      throw conflict('El nuevo horario deja citas pendientes fuera de horario. Cancélalas o muévelas antes.', {
        bookingsOutsideHours: outside.length,
      });
    }
  }

  private async ensureProfessional(db: Db | Tx, tenantId: string, id: string): Promise<void> {
    if (!(await db.professional.findFirst({ where: { tenantId, id }, select: { id: true } }))) throw notFound();
  }
}
