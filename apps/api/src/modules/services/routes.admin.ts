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

  app.get('/services', { onRequest: anyRole, schema: { querystring: ServiceListQuery } }, async (request) => {
    const { tenant } = requireAuthContext(request);
    return { items: await services.list(tenant.id, request.query.includeInactive) };
  });

  app.get('/services/:id', { onRequest: anyRole, schema: { params: zIdParams } }, async (request) =>
    services.get(requireAuthContext(request).tenant.id, request.params.id),
  );

  app.post('/services', { onRequest: admin, schema: { body: ServiceCreate } }, async (request, reply) => {
    const created = await services.create(userActor(requireAuthContext(request), request), request.body);
    return reply.status(201).send(created);
  });

  app.patch('/services/:id', { onRequest: admin, schema: { params: zIdParams, body: ServicePatch } }, async (request) =>
    services.update(userActor(requireAuthContext(request), request), request.params.id, request.body),
  );

  app.delete('/services/:id', { onRequest: admin, schema: { params: zIdParams } }, async (request) =>
    services.archive(userActor(requireAuthContext(request), request), request.params.id),
  );
};
