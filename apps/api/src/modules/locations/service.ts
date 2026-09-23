import type { Db, Tx } from '../../db.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import { conflict, notFound, validationError } from '../../lib/errors.ts';
import { toE164 } from '../../lib/phone.ts';
import { toAuditJson, writeAudit, type Actor } from '../audit/audit.ts';
import { LOCATION_SELECT } from './schemas.ts';

export type LocationDto = Prisma.LocationGetPayload<{ select: typeof LOCATION_SELECT }>;

interface LocationInput {
  name?: string;
  address?: string | null;
  mapsUrl?: string | null;
  whatsapp?: string | null;
  sortOrder?: number;
  isDefault?: boolean;
  active?: boolean;
}

/**
 * Locales de un tenant. Siempre hay exactamente un local por defecto y activo (el que usan las páginas
 * sin selector de local). Todas las consultas filtran por tenantId.
 */
export class LocationsService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
  ) {}

  list(tenantId: string, includeInactive: boolean): Promise<LocationDto[]> {
    return this.db.location.findMany({
      where: { tenantId, ...(includeInactive ? {} : { active: true }) },
      select: LOCATION_SELECT,
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async get(tenantId: string, id: string): Promise<LocationDto> {
    return this.find(this.db, tenantId, id);
  }

  async create(actor: Actor, input: LocationInput & { name: string }): Promise<LocationDto> {
    const data = await this.normalize(actor.tenantId, input);
    return this.db.$transaction(async (tx) => {
      if (data.isDefault) await tx.location.updateMany({ where: { tenantId: actor.tenantId, isDefault: true }, data: { isDefault: false } });
      const created = await tx.location.create({ data: { ...data, tenantId: actor.tenantId }, select: LOCATION_SELECT });
      await writeAudit(tx, { ...actor, action: 'location.created', entityType: 'Location', entityId: created.id, after: toAuditJson(created) });
      return created;
    });
  }

  async update(actor: Actor, id: string, input: LocationInput): Promise<LocationDto> {
    const data = await this.normalize(actor.tenantId, input);
    return this.db.$transaction(async (tx) => {
      const before = await this.find(tx, actor.tenantId, id);
      if (before.isDefault && (data.isDefault === false || data.active === false)) {
        throw conflict('Debe haber un local por defecto. Marca otro como predeterminado antes.');
      }
      if (data.isDefault && data.active === false) throw validationError([{ path: 'body.active', message: 'El local por defecto debe estar activo.' }]);
      if (data.isDefault && !before.active && data.active !== true) {
        throw validationError([{ path: 'body.isDefault', message: 'Activa el local para hacerlo predeterminado.' }]);
      }
      if (data.active === false && before.active) await this.ensureUnused(tx, actor.tenantId, id);
      if (data.isDefault && !before.isDefault) {
        await tx.location.updateMany({ where: { tenantId: actor.tenantId, isDefault: true }, data: { isDefault: false } });
      }
      const after = await tx.location.update({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, data, select: LOCATION_SELECT });
      await writeAudit(tx, {
        ...actor,
        action: 'location.updated',
        entityType: 'Location',
        entityId: id,
        before: toAuditJson(before),
        after: toAuditJson(after),
      });
      return after;
    });
  }

  archive(actor: Actor, id: string): Promise<LocationDto> {
    return this.update(actor, id, { active: false });
  }

  private async find(db: Db | Tx, tenantId: string, id: string): Promise<LocationDto> {
    const row = await db.location.findFirst({ where: { tenantId, id }, select: LOCATION_SELECT });
    if (!row) throw notFound();
    return row;
  }

  private async normalize<T extends LocationInput>(tenantId: string, input: T): Promise<T> {
    if (input.whatsapp == null) return input;
    const tenant = await this.db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCountryCode: true } });
    const e164 = toE164(input.whatsapp, tenant.defaultCountryCode);
    if (!e164) throw validationError([{ path: 'body.whatsapp', message: 'Número de WhatsApp inválido.' }]);
    return { ...input, whatsapp: e164 };
  }

  /** Un local con horarios o citas futuras no se desactiva: se dejarían huecos o citas huérfanas. */
  private async ensureUnused(tx: Tx, tenantId: string, locationId: string): Promise<void> {
    const [workingHours, futureBookings] = await Promise.all([
      tx.workingHour.count({ where: { tenantId, locationId } }),
      tx.booking.count({ where: { tenantId, locationId, status: { in: ['PENDING', 'CONFIRMED'] }, endAt: { gt: this.now() } } }),
    ]);
    if (workingHours || futureBookings) {
      throw conflict('El local tiene horarios o citas pendientes. Muévelos antes de desactivarlo.', { workingHours, futureBookings });
    }
  }
}
