import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db.ts';
import { requireAuthContext, requireRole } from '../../plugins/auth.ts';
import { waLink } from './transport.ts';

const Query = z
  .object({
    status: z.enum(['PENDING', 'SENT', 'FAILED', 'CANCELLED']).optional(),
    bookingId: z.uuid().optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

/**
 * GET /admin/notifications — avisos del negocio (solo ADMIN). Con el transporte "log" (opción C) no se
 * envía nada fuera: cada aviso trae su enlace wa.me para mandarlo a mano si se quiere.
 */
export const notificationAdminRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get('/notifications', { preHandler: requireRole('ADMIN'), schema: { querystring: Query } }, async (request) => {
    const { tenant } = requireAuthContext(request);
    const q = request.query;
    const rows = await db.notificationOutbox.findMany({
      where: { tenantId: tenant.id, ...(q.status ? { status: q.status } : {}), ...(q.bookingId ? { bookingId: q.bookingId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, q.limit).map((n) => {
      const payload = n.payload as { to: string; text: string };
      return {
        id: n.id,
        bookingId: n.bookingId,
        audience: n.audience,
        template: n.template,
        status: n.status,
        to: payload.to,
        text: payload.text,
        waUrl: waLink(payload.to, payload.text),
        attempts: n.attempts,
        lastError: n.lastError,
        scheduledFor: n.nextAttemptAt,
        sentAt: n.sentAt,
        createdAt: n.createdAt,
      };
    });
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  });
};
