import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../../db.ts';
import { forbidden, notFound, validationError } from '../../lib/errors.ts';
import { zIdParams } from '../../lib/validation.ts';
import { requireAuthContext, requireRole, type AuthContext } from '../../plugins/auth.ts';
import { userActor } from '../audit/audit.ts';
import { TimeBlockCreate, TimeBlockListQuery, WorkingHoursPut } from './schemas.ts';
import { TimeBlocksService } from './time-blocks.ts';
import { WorkingHoursService } from './working-hours.ts';

const DAY_MS = 86_400_000;

/** Un PROFESSIONAL solo ve y gestiona lo suyo; para él, lo ajeno "no existe" (404). */
function ownProfessionalOrAdmin(auth: AuthContext, professionalId: string): void {
  if (auth.user.role === 'ADMIN') return;
  if (auth.user.professionalId !== professionalId) throw notFound();
}

export const scheduleAdminRoutes: FastifyPluginAsyncZod<{ db: Db; now: () => Date }> = async (app, { db, now }) => {
  const hours = new WorkingHoursService(db, now);
  const blocks = new TimeBlocksService(db);
  const anyRole = requireRole('ADMIN', 'PROFESSIONAL');

  app.get('/professionals/:id/working-hours', { onRequest: anyRole, schema: { params: zIdParams } }, async (request) => {
    const auth = requireAuthContext(request);
    ownProfessionalOrAdmin(auth, request.params.id);
    return { items: await hours.get(auth.tenant.id, request.params.id) };
  });

  app.put(
    '/professionals/:id/working-hours',
    { onRequest: requireRole('ADMIN'), schema: { params: zIdParams, body: WorkingHoursPut } },
    async (request) => ({
      items: await hours.replace(userActor(requireAuthContext(request), request), request.params.id, request.body.intervals),
    }),
  );

  app.get('/time-blocks', { onRequest: anyRole, schema: { querystring: TimeBlockListQuery } }, async (request) => {
    const auth = requireAuthContext(request);
    const from = request.query.from ?? now();
    const to = request.query.to ?? new Date(from.getTime() + 60 * DAY_MS);
    if (to <= from || to.getTime() - from.getTime() > 366 * DAY_MS) {
      throw validationError([{ path: 'querystring.to', message: 'Rango inválido (máximo 366 días).' }]);
    }
    const isAdmin = auth.user.role === 'ADMIN';
    // Un usuario PROFESSIONAL sin ficha de profesional vinculada no tiene agenda que ver.
    if (!isAdmin && !auth.user.professionalId) return { items: [] };
    return {
      items: await blocks.list(auth.tenant.id, {
        from,
        to,
        professionalId: request.query.professionalId,
        locationId: request.query.locationId,
        ...(isAdmin ? {} : { onlyForProfessional: auth.user.professionalId! }),
      }),
    };
  });

  app.post('/time-blocks', { onRequest: anyRole, schema: { body: TimeBlockCreate } }, async (request, reply) => {
    const auth = requireAuthContext(request);
    const body = request.body;
    let professionalId = body.professionalId ?? null;
    if (auth.user.role !== 'ADMIN') {
      // Un profesional solo bloquea su propia agenda; no puede cerrar el local ni tocar la de otro.
      const own = auth.user.professionalId;
      if (!own || (body.professionalId !== undefined && body.professionalId !== own) || body.locationId) throw forbidden();
      professionalId = own;
    }
    const created = await blocks.create(userActor(auth, request), {
      professionalId,
      locationId: body.locationId ?? null,
      startAt: body.startAt,
      endAt: body.endAt,
      reason: body.reason || null,
    });
    return reply.status(201).send(created);
  });

  app.delete('/time-blocks/:id', { onRequest: anyRole, schema: { params: zIdParams } }, async (request, reply) => {
    const auth = requireAuthContext(request);
    const isAdmin = auth.user.role === 'ADMIN';
    if (!isAdmin && !auth.user.professionalId) throw notFound();
    await blocks.remove(userActor(auth, request), request.params.id, isAdmin ? undefined : auth.user.professionalId!);
    return reply.status(204).send();
  });
};
