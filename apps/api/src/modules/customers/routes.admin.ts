import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../../db.ts';
import { zIdParams } from '../../lib/validation.ts';
import { requireAuthContext, requireRole, type AuthContext } from '../../plugins/auth.ts';
import { userActor } from '../audit/audit.ts';
import { CustomerCreate, CustomerListQuery, CustomerPatch } from './schemas.ts';
import { CustomersService } from './service.ts';

/**
 * PROFESSIONAL: solo lectura de los clientes que tienen (o tuvieron) cita con él. Un usuario PROFESSIONAL
 * sin ficha vinculada filtra por un id que no existe, así no ve ningún cliente.
 */
const scopeFor = (auth: AuthContext): string | undefined =>
  auth.user.role === 'ADMIN' ? undefined : (auth.user.professionalId ?? '00000000-0000-0000-0000-000000000000');

export const customerAdminRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const customers = new CustomersService(db);
  const anyRole = requireRole('ADMIN', 'PROFESSIONAL');
  const admin = requireRole('ADMIN');

  app.get('/customers', { preHandler: anyRole, schema: { querystring: CustomerListQuery } }, async (request) => {
    const auth = requireAuthContext(request);
    return customers.list(auth.tenant.id, request.query, scopeFor(auth));
  });

  app.get('/customers/:id', { preHandler: anyRole, schema: { params: zIdParams } }, async (request) => {
    const auth = requireAuthContext(request);
    return customers.get(auth.tenant.id, request.params.id, scopeFor(auth));
  });

  app.post('/customers', { preHandler: admin, schema: { body: CustomerCreate } }, async (request, reply) =>
    reply.status(201).send(await customers.create(userActor(requireAuthContext(request), request), request.body)),
  );

  app.patch('/customers/:id', { preHandler: admin, schema: { params: zIdParams, body: CustomerPatch } }, async (request) =>
    customers.update(userActor(requireAuthContext(request), request), request.params.id, request.body),
  );
};
