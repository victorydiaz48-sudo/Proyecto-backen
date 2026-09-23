import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../../db.ts';
import { zIdParams } from '../../lib/validation.ts';
import { requireAuthContext, requireRole } from '../../plugins/auth.ts';
import { userActor } from '../audit/audit.ts';
import { ProfessionalCreate, ProfessionalListQuery, ProfessionalPatch, ProfessionalServicesPut } from './schemas.ts';
import { ProfessionalsService } from './service.ts';

/** /admin/professionals — lectura para ADMIN y PROFESSIONAL; cambios solo ADMIN. */
export const professionalAdminRoutes: FastifyPluginAsyncZod<{ db: Db; now: () => Date }> = async (app, { db, now }) => {
  const pros = new ProfessionalsService(db, now);
  const anyRole = requireRole('ADMIN', 'PROFESSIONAL');
  const admin = requireRole('ADMIN');

  app.get('/professionals', { preHandler: anyRole, schema: { querystring: ProfessionalListQuery } }, async (request) => {
    const { tenant } = requireAuthContext(request);
    return { items: await pros.list(tenant.id, request.query) };
  });

  app.get('/professionals/:id', { preHandler: anyRole, schema: { params: zIdParams } }, async (request) =>
    pros.get(requireAuthContext(request).tenant.id, request.params.id),
  );

  app.post('/professionals', { preHandler: admin, schema: { body: ProfessionalCreate } }, async (request, reply) => {
    const created = await pros.create(userActor(requireAuthContext(request), request), request.body);
    return reply.status(201).send(created);
  });

  app.patch('/professionals/:id', { preHandler: admin, schema: { params: zIdParams, body: ProfessionalPatch } }, async (request) =>
    pros.update(userActor(requireAuthContext(request), request), request.params.id, request.body),
  );

  app.delete('/professionals/:id', { preHandler: admin, schema: { params: zIdParams } }, async (request) =>
    pros.archive(userActor(requireAuthContext(request), request), request.params.id),
  );

  app.put(
    '/professionals/:id/services',
    { preHandler: admin, schema: { params: zIdParams, body: ProfessionalServicesPut } },
    async (request) => pros.setServices(userActor(requireAuthContext(request), request), request.params.id, request.body.serviceIds),
  );
};
