import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../../db.ts';
import { zIdParams } from '../../lib/validation.ts';
import { requireAuthContext, requireRole } from '../../plugins/auth.ts';
import { userActor } from '../audit/audit.ts';
import { AuditListQuery, UserCreate, UserPatch } from './schemas.ts';
import { UsersService } from './service.ts';

/** /admin/users y /admin/audit-logs — solo ADMIN. */
export const userAdminRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const users = new UsersService(db);
  const admin = requireRole('ADMIN');

  app.get('/users', { onRequest: admin }, async (request) => ({ items: await users.list(requireAuthContext(request).tenant.id) }));

  app.post('/users', { onRequest: admin, schema: { body: UserCreate } }, async (request, reply) =>
    reply.status(201).send(await users.create(userActor(requireAuthContext(request), request), request.body)),
  );

  app.patch('/users/:id', { onRequest: admin, schema: { params: zIdParams, body: UserPatch } }, async (request) =>
    users.update(userActor(requireAuthContext(request), request), request.params.id, request.body),
  );

  app.post(
    '/users/:id/reset-password',
    { onRequest: admin, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } }, schema: { params: zIdParams } },
    async (request) => users.resetPassword(userActor(requireAuthContext(request), request), request.params.id),
  );

  app.get('/audit-logs', { onRequest: admin, schema: { querystring: AuditListQuery } }, async (request) => {
    const { tenant } = requireAuthContext(request);
    const q = request.query;
    const rows = await db.auditLog.findMany({
      where: {
        tenantId: tenant.id,
        ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.action ? { action: q.action } : {}),
      },
      select: {
        id: true, createdAt: true, action: true, entityType: true, entityId: true, actorType: true, before: true, after: true, ip: true,
        actor: { select: { id: true, email: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, q.limit);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  });
};
