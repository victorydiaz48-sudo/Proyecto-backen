import { PgErrorCode, pgErrorCode, type Db } from '../../db.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import { conflict, notFound } from '../../lib/errors.ts';
import { toAuditJson as toJson, writeAudit, type Actor } from '../audit/audit.ts';
import { SERVICE_SELECT } from './schemas.ts';

export type ServiceDto = Prisma.ServiceGetPayload<{ select: typeof SERVICE_SELECT }>;

const duplicateName = () => conflict('Ya existe un servicio activo con ese nombre.');

/**
 * Servicios de un tenant. Todas las consultas filtran por tenantId (docs/ARCHITECTURE.md §3):
 * un id de otro tenant se comporta exactamente igual que un id inexistente.
 */
export class ServicesService {
  constructor(private readonly db: Db) {}

  list(tenantId: string, includeInactive: boolean): Promise<ServiceDto[]> {
    return this.db.service.findMany({
      where: { tenantId, ...(includeInactive ? {} : { active: true }) },
      select: SERVICE_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async get(tenantId: string, id: string): Promise<ServiceDto> {
    const s = await this.db.service.findFirst({ where: { tenantId, id }, select: SERVICE_SELECT });
    if (!s) throw notFound();
    return s;
  }

  async create(actor: Actor, data: Omit<Prisma.ServiceUncheckedCreateInput, 'tenantId'>): Promise<ServiceDto> {
    return this.mapUnique(() =>
      this.db.$transaction(async (tx) => {
        const created = await tx.service.create({ data: { ...data, tenantId: actor.tenantId }, select: SERVICE_SELECT });
        await writeAudit(tx, { ...actor, action: 'service.created', entityType: 'Service', entityId: created.id, after: toJson(created) });
        return created;
      }),
    );
  }

  /** Cambiar precio o duración no altera las citas existentes: guardan su propia copia. */
  async update(actor: Actor, id: string, data: Prisma.ServiceUncheckedUpdateInput): Promise<ServiceDto> {
    return this.mapUnique(() =>
      this.db.$transaction(async (tx) => {
        const before = await tx.service.findFirst({ where: { tenantId: actor.tenantId, id }, select: SERVICE_SELECT });
        if (!before) throw notFound();
        const after = await tx.service.update({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, data, select: SERVICE_SELECT });
        await writeAudit(tx, { ...actor, action: 'service.updated', entityType: 'Service', entityId: id, before: toJson(before), after: toJson(after) });
        return after;
      }),
    );
  }

  /** Borrado lógico: las citas históricas siguen referenciando el servicio. */
  archive(actor: Actor, id: string): Promise<ServiceDto> {
    return this.update(actor, id, { active: false });
  }

  private async mapUnique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (pgErrorCode(err) === PgErrorCode.UNIQUE_VIOLATION) throw duplicateName();
      throw err;
    }
  }
}

