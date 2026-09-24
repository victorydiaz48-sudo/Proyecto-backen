import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db.ts';
import { validationError } from '../../lib/errors.ts';
import { requireAuthContext, requireRole } from '../../plugins/auth.ts';
import { zLocalDate } from '../bookings/schemas.ts';
import { AvailabilityService } from './service.ts';

export const AvailabilityQuerySchema = z
  .object({
    serviceId: z.uuid(),
    professionalId: z.union([z.uuid(), z.literal('any')]),
    date: zLocalDate.optional(),
    from: zLocalDate.optional(),
    to: zLocalDate.optional(),
    locationId: z.uuid().optional(),
  })
  .strict();

/** date=YYYY-MM-DD, o from/to (fechas locales del negocio). */
export function dateRange(q: { date?: string | undefined; from?: string | undefined; to?: string | undefined }): { fromDate: string; toDate: string } {
  if (q.date && !q.from && !q.to) return { fromDate: q.date, toDate: q.date };
  if (!q.date && q.from && q.to) return { fromDate: q.from, toDate: q.to };
  throw validationError([{ path: 'querystring.date', message: 'Indica date, o from y to.' }]);
}

/** GET /admin/availability — como la pública, sin antelación mínima ni horizonte. */
export const availabilityAdminRoutes: FastifyPluginAsyncZod<{ db: Db; now: () => Date }> = async (app, { db, now }) => {
  const availability = new AvailabilityService(db, now);
  app.get(
    '/availability',
    { onRequest: requireRole('ADMIN', 'PROFESSIONAL'), schema: { querystring: AvailabilityQuerySchema } },
    async (request) => {
      const { tenant } = requireAuthContext(request);
      const q = request.query;
      return availability.availability(
        tenant.id,
        { serviceId: q.serviceId, professionalId: q.professionalId, locationId: q.locationId, ...dateRange(q) },
        { publicRules: false },
      );
    },
  );
};
