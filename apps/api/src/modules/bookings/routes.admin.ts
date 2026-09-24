import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../../db.ts';
import { zIdParams } from '../../lib/validation.ts';
import { requireAuthContext, requireRole, type AuthContext } from '../../plugins/auth.ts';
import { userActor } from '../audit/audit.ts';
import { BookingCreate, BookingListQuery, BookingReschedule, BookingStatusChange } from './schemas.ts';
import { BookingsService, type Viewer } from './service.ts';

const viewerOf = (auth: AuthContext): Viewer => ({ role: auth.user.role, professionalId: auth.user.professionalId });

/** /admin/bookings — ADMIN: todas; PROFESSIONAL: solo las suyas (lo ajeno responde 404). */
export const bookingAdminRoutes: FastifyPluginAsyncZod<{ db: Db; now: () => Date }> = async (app, { db, now }) => {
  const bookings = new BookingsService(db, now);
  const anyRole = requireRole('ADMIN', 'PROFESSIONAL');

  app.get('/bookings', { onRequest: anyRole, schema: { querystring: BookingListQuery } }, async (request) => {
    const auth = requireAuthContext(request);
    return { items: await bookings.list(auth.tenant.id, viewerOf(auth), request.query) };
  });

  app.get('/bookings/:id', { onRequest: anyRole, schema: { params: zIdParams } }, async (request) => {
    const auth = requireAuthContext(request);
    return bookings.get(auth.tenant.id, viewerOf(auth), request.params.id);
  });

  app.post('/bookings', { onRequest: anyRole, schema: { body: BookingCreate } }, async (request, reply) => {
    const auth = requireAuthContext(request);
    return reply.status(201).send(await bookings.create(userActor(auth, request), viewerOf(auth), request.body));
  });

  app.patch('/bookings/:id', { onRequest: anyRole, schema: { params: zIdParams, body: BookingReschedule } }, async (request) => {
    const auth = requireAuthContext(request);
    return bookings.reschedule(userActor(auth, request), viewerOf(auth), request.params.id, request.body);
  });

  app.post('/bookings/:id/status', { onRequest: anyRole, schema: { params: zIdParams, body: BookingStatusChange } }, async (request) => {
    const auth = requireAuthContext(request);
    return bookings.changeStatus(userActor(auth, request), viewerOf(auth), request.params.id, request.body.status, request.body.reason);
  });
};
