import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../../db.ts';
import { zIdParams } from '../../lib/validation.ts';
import { requireAuthContext, requireRole } from '../../plugins/auth.ts';
import { userActor } from '../audit/audit.ts';
import { ServiceCreate, ServiceListQuery, ServicePatch } from './schemas.ts';
import { ServicesService } from './service.ts';

/** /admin/services — lectura para ADMIN y PROFESSIONAL; cambios solo ADMIN. */
export const serviceAdminRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const services = new ServicesService(db);
  const anyRole = requireRole('ADMIN', 'PROFESSIONAL');
  const admin = requireRole('ADMIN');

  app.get('/services', { preHandler: anyRole, schema: { querystring: ServiceListQuery } }, async (request) => {
    const { tenant } = requireAuthContext(request);
    return { items: await services.list(tenant.id, request.query.includeInactive) };
  });

  app.get('/services/:id', { preHandler: anyRole, schema: { params: zIdParams } }, async (request) =>
    services.get(requireAuthContext(request).tenant.id, request.params.id),
  );

  app.post('/services', { preHandler: admin, schema: { body: ServiceCreate } }, async (request, reply) => {
    const created = await services.create(userActor(requireAuthContext(request), request), request.body);
    return reply.status(201).send(created);
  });

  app.patch('/services/:id', { preHandler: admin, schema: { params: zIdParams, body: ServicePatch } }, async (request) =>
    services.update(userActor(requireAuthContext(request), request), request.params.id, request.body),
  );

  app.delete('/services/:id', { preHandler: admin, schema: { params: zIdParams } }, async (request) =>
    services.archive(userActor(requireAuthContext(request), request), request.params.id),
  );
};
