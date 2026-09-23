import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../../db.ts';
import { zIdParams } from '../../lib/validation.ts';
import { requireAuthContext, requireRole } from '../../plugins/auth.ts';
import { userActor } from '../audit/audit.ts';
import { LocationCreate, LocationListQuery, LocationPatch } from './schemas.ts';
import { LocationsService } from './service.ts';

/** /admin/locations — lectura para ADMIN y PROFESSIONAL; cambios solo ADMIN. */
export const locationAdminRoutes: FastifyPluginAsyncZod<{ db: Db; now: () => Date }> = async (app, { db, now }) => {
  const locations = new LocationsService(db, now);
  const anyRole = requireRole('ADMIN', 'PROFESSIONAL');
  const admin = requireRole('ADMIN');

  app.get('/locations', { preHandler: anyRole, schema: { querystring: LocationListQuery } }, async (request) => ({
    items: await locations.list(requireAuthContext(request).tenant.id, request.query.includeInactive),
  }));

  app.get('/locations/:id', { preHandler: anyRole, schema: { params: zIdParams } }, async (request) =>
    locations.get(requireAuthContext(request).tenant.id, request.params.id),
  );

  app.post('/locations', { preHandler: admin, schema: { body: LocationCreate } }, async (request, reply) =>
    reply.status(201).send(await locations.create(userActor(requireAuthContext(request), request), request.body)),
  );

  app.patch('/locations/:id', { preHandler: admin, schema: { params: zIdParams, body: LocationPatch } }, async (request) =>
    locations.update(userActor(requireAuthContext(request), request), request.params.id, request.body),
  );

  app.delete('/locations/:id', { preHandler: admin, schema: { params: zIdParams } }, async (request) =>
    locations.archive(userActor(requireAuthContext(request), request), request.params.id),
  );
};
