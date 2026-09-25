import type { Db, Tx } from '../../db.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import { conflict, notFound, validationError } from '../../lib/errors.ts';
import { toAuditJson as toJson, writeAudit, type Actor } from '../audit/audit.ts';
import { PROFESSIONAL_SELECT } from './schemas.ts';

type Row = Prisma.ProfessionalGetPayload<{ select: typeof PROFESSIONAL_SELECT }>;

export type ProfessionalDto = Omit<Row, 'services'> & { serviceIds: string[] };

const toDto = ({ services, ...rest }: Row): ProfessionalDto => ({ ...rest, serviceIds: services.map((s) => s.serviceId) });

/** Profesionales de un tenant. Todas las consultas filtran por tenantId. */
export class ProfessionalsService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
  ) {}

  async list(tenantId: string, opts: { includeInactive: boolean; serviceId?: string | undefined }): Promise<ProfessionalDto[]> {
    const rows = await this.db.professional.findMany({
      where: {
        tenantId,
        ...(opts.includeInactive ? {} : { active: true }),
        ...(opts.serviceId ? { services: { some: { serviceId: opts.serviceId } } } : {}),
      },
      select: PROFESSIONAL_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
    return rows.map(toDto);
  }

  async get(tenantId: string, id: string): Promise<ProfessionalDto> {
    return toDto(await this.find(this.db, tenantId, id));
  }

  async create(
    actor: Actor,
    input: Omit<Prisma.ProfessionalUncheckedCreateInput, 'tenantId' | 'userId'> & { serviceIds: string[] },
  ): Promise<ProfessionalDto> {
    const { serviceIds, ...data } = input;
    return this.db.$transaction(async (tx) => {
      const ids = await this.checkServiceIds(tx, actor.tenantId, serviceIds);
      const pro = await tx.professional.create({ data: { ...data, tenantId: actor.tenantId }, select: { id: true } });
      await tx.professionalService.createMany({
        data: ids.map((serviceId) => ({ tenantId: actor.tenantId, professionalId: pro.id, serviceId })),
      });
      const created = toDto(await this.find(tx, actor.tenantId, pro.id));
      await writeAudit(tx, { ...actor, action: 'professional.created', entityType: 'Professional', entityId: pro.id, after: toJson(created) });
      return created;
    });
  }

  async update(actor: Actor, id: string, data: Prisma.ProfessionalUncheckedUpdateInput): Promise<ProfessionalDto> {
    return this.db.$transaction(async (tx) => {
      const before = toDto(await this.find(tx, actor.tenantId, id));
      if (data.active === false && before.active) await this.ensureNoFutureBookings(tx, actor.tenantId, id);
      await tx.professional.update({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, data });
      const after = toDto(await this.find(tx, actor.tenantId, id));
      await writeAudit(tx, { ...actor, action: 'professional.updated', entityType: 'Professional', entityId: id, before: toJson(before), after: toJson(after) });
      return after;
    });
  }

  /** Borrado lógico. Se niega si tiene citas futuras activas: primero hay que cancelarlas o moverlas. */
  archive(actor: Actor, id: string): Promise<ProfessionalDto> {
    return this.update(actor, id, { active: false });
  }

  /** Reemplaza la lista completa de servicios que hace el profesional. */
  async setServices(actor: Actor, id: string, serviceIds: string[]): Promise<ProfessionalDto> {
    return this.db.$transaction(async (tx) => {
      const before = toDto(await this.find(tx, actor.tenantId, id));
      const ids = await this.checkServiceIds(tx, actor.tenantId, serviceIds);
      await tx.professionalService.deleteMany({ where: { tenantId: actor.tenantId, professionalId: id } });
      await tx.professionalService.createMany({
        data: ids.map((serviceId) => ({ tenantId: actor.tenantId, professionalId: id, serviceId })),
      });
      const after = toDto(await this.find(tx, actor.tenantId, id));
      await writeAudit(tx, {
        ...actor,
        action: 'professional.services_updated',
        entityType: 'Professional',
        entityId: id,
        before: { serviceIds: before.serviceIds },
        after: { serviceIds: after.serviceIds },
      });
      return after;
    });
  }

  private async find(db: Db | Tx, tenantId: string, id: string): Promise<Row> {
    const row = await db.professional.findFirst({ where: { tenantId, id }, select: PROFESSIONAL_SELECT });
    if (!row) throw notFound();
    return row;
  }

  /** Todos los ids deben ser servicios de este tenant. Mismo error para inexistente y de otro tenant. */
  private async checkServiceIds(db: Tx, tenantId: string, serviceIds: string[]): Promise<string[]> {
    const ids = [...new Set(serviceIds)];
    if (ids.length === 0) return ids;
    const found = new Set(
      (await db.service.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } })).map((s) => s.id),
    );
    const missing = serviceIds.flatMap((sid, i) => (found.has(sid) ? [] : [{ path: `body.serviceIds.${i}`, message: 'Servicio no encontrado.' }]));
    if (missing.length) throw validationError(missing);
    return ids;
  }

  private async ensureNoFutureBookings(db: Tx, tenantId: string, professionalId: string): Promise<void> {
    const futureBookings = await db.booking.count({
      where: { tenantId, professionalId, status: { in: ['PENDING', 'CONFIRMED'] }, endAt: { gt: this.now() } },
    });
    if (futureBookings > 0) {
      throw conflict('El profesional tiene citas pendientes. Cancélalas o reasígnalas antes de desactivarlo.', { futureBookings });
    }
  }
}
