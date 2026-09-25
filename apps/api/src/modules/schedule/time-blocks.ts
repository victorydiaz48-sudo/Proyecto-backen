import type { Db, Tx } from '../../db.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import { conflict, notFound, validationError } from '../../lib/errors.ts';
import { toAuditJson, writeAudit, type Actor } from '../audit/audit.ts';
import { lockProfessionals } from './locks.ts';

export const TIME_BLOCK_SELECT = {
  id: true,
  professionalId: true,
  locationId: true,
  startAt: true,
  endAt: true,
  reason: true,
  createdByUserId: true,
  createdAt: true,
} as const;
export type TimeBlockDto = Prisma.TimeBlockGetPayload<{ select: typeof TIME_BLOCK_SELECT }>;

export interface TimeBlockInput {
  professionalId: string | null;
  locationId: string | null;
  startAt: Date;
  endAt: Date;
  reason: string | null;
}

/**
 * Bloqueos de agenda (vacaciones, pausas, cierre del local). Un bloqueo con professionalId = null
 * afecta a todos los profesionales (del local indicado, o del negocio entero si locationId es null).
 */
export class TimeBlocksService {
  constructor(private readonly db: Db) {}

  list(
    tenantId: string,
    q: { from: Date; to: Date; professionalId?: string | undefined; locationId?: string | undefined; onlyForProfessional?: string },
  ): Promise<TimeBlockDto[]> {
    const and: Prisma.TimeBlockWhereInput[] = [{ tenantId, startAt: { lt: q.to }, endAt: { gt: q.from } }];
    if (q.professionalId) and.push({ OR: [{ professionalId: q.professionalId }, { professionalId: null }] });
    if (q.locationId) and.push({ OR: [{ locationId: q.locationId }, { locationId: null }] });
    if (q.onlyForProfessional) and.push({ OR: [{ professionalId: q.onlyForProfessional }, { professionalId: null }] });
    return this.db.timeBlock.findMany({ where: { AND: and }, select: TIME_BLOCK_SELECT, orderBy: [{ startAt: 'asc' }, { id: 'asc' }] });
  }

  /** Rechaza el bloqueo si choca con citas activas: hay que cancelarlas o moverlas primero. */
  async create(actor: Actor, input: TimeBlockInput): Promise<TimeBlockDto> {
    return this.db.$transaction(async (tx) => {
      await this.checkRefs(tx, actor.tenantId, input);
      await lockProfessionals(tx, actor.tenantId, input.professionalId ? [input.professionalId] : 'all');
      const conflictingBookings = await tx.booking.count({
        where: {
          tenantId: actor.tenantId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          startAt: { lt: input.endAt },
          endAt: { gt: input.startAt },
          ...(input.professionalId ? { professionalId: input.professionalId } : {}),
          ...(input.locationId ? { locationId: input.locationId } : {}),
        },
      });
      if (conflictingBookings) {
        throw conflict('Hay citas pendientes en ese periodo. Cancélalas o muévelas antes de bloquearlo.', { conflictingBookings });
      }
      const created = await tx.timeBlock.create({
        data: { ...input, tenantId: actor.tenantId, createdByUserId: actor.actorUserId ?? null },
        select: TIME_BLOCK_SELECT,
      });
      await writeAudit(tx, { ...actor, action: 'time_block.created', entityType: 'TimeBlock', entityId: created.id, after: toAuditJson(created) });
      return created;
    });
  }

  /** `onlyForProfessional`: un PROFESSIONAL solo puede borrar sus propios bloqueos. */
  async remove(actor: Actor, id: string, onlyForProfessional?: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const block = await tx.timeBlock.findFirst({
        where: { tenantId: actor.tenantId, id, ...(onlyForProfessional ? { professionalId: onlyForProfessional } : {}) },
        select: TIME_BLOCK_SELECT,
      });
      if (!block) throw notFound();
      await tx.timeBlock.delete({ where: { tenantId_id: { tenantId: actor.tenantId, id } } });
      await writeAudit(tx, { ...actor, action: 'time_block.deleted', entityType: 'TimeBlock', entityId: id, before: toAuditJson(block) });
    });
  }

  private async checkRefs(tx: Tx, tenantId: string, input: TimeBlockInput): Promise<void> {
    const errors: { path: string; message: string }[] = [];
    if (input.professionalId && !(await tx.professional.findFirst({ where: { tenantId, id: input.professionalId }, select: { id: true } }))) {
      errors.push({ path: 'body.professionalId', message: 'Profesional no encontrado.' });
    }
    if (input.locationId && !(await tx.location.findFirst({ where: { tenantId, id: input.locationId }, select: { id: true } }))) {
      errors.push({ path: 'body.locationId', message: 'Local no encontrado.' });
    }
    if (errors.length) throw validationError(errors);
  }
}
