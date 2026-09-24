import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { setRequestTenant } from '../../lib/tenant-context.ts';
import { toE164 } from '../../lib/phone.ts';
import { localDateOf } from '../../lib/time.ts';
import { SLUG_RE } from '../../lib/validation.ts';
import { publicActor, toAuditJson } from '../audit/audit.ts';
import { AvailabilityQuerySchema, dateRange } from '../availability/routes.admin.ts';
import { AvailabilityService } from '../availability/service.ts';
import { zLocalDate, zLocalTime } from '../bookings/schemas.ts';
import { BookingsService } from '../bookings/service.ts';
import { zCustomerName, zOptionalEmail, zPhoneInput } from '../customers/schemas.ts';
import { beginIdempotent, IDEMPOTENCY_KEY_RE } from './idempotency.ts';
import { bookingWhatsappUrl } from './whatsapp.ts';

/** Máximo de citas futuras activas por teléfono y negocio (frena el bloqueo masivo de la agenda). */
export const MAX_ACTIVE_BOOKINGS_PER_PHONE = 3;

const SlugParams = z.object({ tenantSlug: z.string().max(60) });

const PublicBookingCreate = z
  .object({
    serviceId: z.uuid(),
    professionalId: z.union([z.uuid(), z.literal('any')]),
    date: zLocalDate,
    time: zLocalTime,
    locationId: z.uuid().nullable().optional(),
    customer: z.object({ name: zCustomerName, phone: zPhoneInput, email: zOptionalEmail.optional() }).strict(),
    notes: z.string().trim().max(300).optional(),
  })
  .strict();

export interface PublicTenant {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  locale: string;
  defaultCountryCode: string;
  slotIntervalMinutes: number;
  bookingLeadMinutes: number;
  bookingHorizonDays: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    publicTenant: PublicTenant | null;
  }
}

/**
 * API pública (/api/v1/public/:tenantSlug/…). Sin cookies ni sesión: el tenant sale SOLO del slug de
 * la URL, resuelto a un negocio activo. Nunca expone datos de otros clientes ni ids internos de usuarios.
 */
export const publicRoutes: FastifyPluginAsyncZod<{ db: Db; now: () => Date }> = async (app, { db, now }) => {
  const availability = new AvailabilityService(db, now);
  const bookings = new BookingsService(db, now);

  app.decorateRequest('publicTenant', null);
  // onRequest (antes de validar el cuerpo): un slug inexistente es 404 aunque el resto venga mal.
  app.addHook('onRequest', async (request) => {
    if (request.method === 'OPTIONS') return;
    const slug = (request.params as { tenantSlug?: string }).tenantSlug?.toLowerCase() ?? '';
    const tenant = SLUG_RE.test(slug)
      ? await db.tenant.findUnique({
          where: { slug },
          select: {
            id: true, slug: true, name: true, timezone: true, currency: true, locale: true, defaultCountryCode: true,
            slotIntervalMinutes: true, bookingLeadMinutes: true, bookingHorizonDays: true, status: true,
          },
        })
      : null;
    if (!tenant || tenant.status !== 'ACTIVE') throw notFound();
    setRequestTenant(tenant.id);
    request.publicTenant = tenant;
  });
  const tenantOf = (request: { publicTenant: PublicTenant | null }): PublicTenant => {
    if (!request.publicTenant) throw notFound();
    return request.publicTenant;
  };

  const readLimit = { rateLimit: { max: 120, timeWindow: '1 minute' } };

  app.get('/:tenantSlug', { config: readLimit, schema: { params: SlugParams } }, async (request) => {
    const t = tenantOf(request);
    const locations = await db.location.findMany({
      where: { tenantId: t.id, active: true },
      select: { id: true, name: true, address: true, mapsUrl: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return {
      name: t.name,
      slug: t.slug,
      timezone: t.timezone,
      currency: t.currency,
      locale: t.locale,
      slotIntervalMinutes: t.slotIntervalMinutes,
      bookingLeadMinutes: t.bookingLeadMinutes,
      bookingHorizonDays: t.bookingHorizonDays,
      today: localDateOf(now(), t.timezone),
      locations,
    };
  });

  app.get('/:tenantSlug/services', { config: readLimit, schema: { params: SlugParams } }, async (request) => {
    const t = tenantOf(request);
    const services = await db.service.findMany({
      where: { tenantId: t.id, active: true },
      select: {
        id: true, name: true, description: true, category: true, durationMinutes: true, priceCents: true,
        professionals: { where: { professional: { active: true } }, select: { professionalId: true }, take: 1 },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return {
      items: services.map(({ professionals, ...s }) => ({ ...s, currency: t.currency, bookable: professionals.length > 0 })),
    };
  });

  app.get(
    '/:tenantSlug/professionals',
    {
      config: readLimit,
      schema: { params: SlugParams, querystring: z.object({ serviceId: z.uuid().optional(), locationId: z.uuid().optional() }).strict() },
    },
    async (request) => {
      const t = tenantOf(request);
      const { serviceId, locationId } = request.query;
      const pros = await db.professional.findMany({
        where: {
          tenantId: t.id,
          active: true,
          ...(serviceId ? { services: { some: { serviceId, service: { active: true } } } } : {}),
          ...(locationId ? { workingHours: { some: { locationId } } } : {}),
        },
        select: {
          id: true, displayName: true, title: true, bio: true, photoUrl: true,
          services: { where: { service: { active: true } }, select: { serviceId: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      });
      return { items: pros.map(({ services, ...p }) => ({ ...p, serviceIds: services.map((s) => s.serviceId) })) };
    },
  );

  app.get(
    '/:tenantSlug/availability',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { params: SlugParams, querystring: AvailabilityQuerySchema } },
    async (request) => {
      const q = request.query;
      return availability.availability(
        tenantOf(request).id,
        { serviceId: q.serviceId, professionalId: q.professionalId, locationId: q.locationId, ...dateRange(q) },
        { publicRules: true },
      );
    },
  );

  app.post(
    '/:tenantSlug/bookings',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { params: SlugParams, body: PublicBookingCreate } },
    async (request, reply) => {
      const t = tenantOf(request);
      const body = request.body;

      const keyHeader = request.headers['idempotency-key'];
      const key = typeof keyHeader === 'string' ? keyHeader : undefined;
      if (key !== undefined && !IDEMPOTENCY_KEY_RE.test(key)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Idempotency-Key inválida (8–100 caracteres: letras, números, - y _).');
      }
      const idem = key ? await beginIdempotent(db, t.id, key, body, now()) : null;
      if (idem?.kind === 'replay') {
        return reply.status(idem.status).header('idempotent-replayed', 'true').send(idem.body);
      }

      try {
        const phoneE164 = toE164(body.customer.phone, t.defaultCountryCode);
        if (!phoneE164) throw new AppError(400, 'VALIDATION_ERROR', 'Datos inválidos.', { fields: [{ path: 'body.customer.phone', message: 'Teléfono inválido.' }] });
        const active = await db.booking.count({
          where: { tenantId: t.id, customer: { phoneE164 }, status: { in: ['PENDING', 'CONFIRMED'] }, endAt: { gt: now() } },
        });
        if (active >= MAX_ACTIVE_BOOKINGS_PER_PHONE) {
          throw new AppError(429, 'BOOKING_LIMIT_REACHED', 'Ya tienes varias citas pendientes. Contacta con el negocio para reservar más.');
        }

        const booking = await bookings.create(
          publicActor(t.id, request),
          null,
          { ...body, customer: body.customer },
          { publicRules: true, source: 'PUBLIC_WEB' },
        );
        const location = await db.location.findFirst({ where: { tenantId: t.id, id: booking.location.id }, select: { whatsapp: true } });
        const fallback = location?.whatsapp
          ? null
          : await db.location.findFirst({ where: { tenantId: t.id, isDefault: true }, select: { whatsapp: true } });
        const wa = location?.whatsapp ?? fallback?.whatsapp ?? null;

        const response = {
          booking: {
            id: booking.id,
            status: booking.status,
            startAt: booking.startAt,
            endAt: booking.endAt,
            localDate: booking.localDate,
            localTime: booking.localTime,
            service: { name: booking.service.name, durationMinutes: booking.service.durationMinutes, priceCents: booking.priceCents, currency: booking.currency },
            professional: booking.professional,
            location: booking.location,
          },
          whatsappUrl: wa
            ? bookingWhatsappUrl(wa, t.locale, {
                businessName: t.name,
                customerName: body.customer.name,
                serviceName: booking.service.name,
                professionalName: booking.professional.displayName,
                localDate: booking.localDate,
                localTime: booking.localTime,
              })
            : null,
        };
        if (idem?.kind === 'new') await idem.complete(201, toAuditJson(response));
        return reply.status(201).send(response);
      } catch (err) {
        if (idem?.kind === 'new') await idem.abandon();
        throw err;
      }
    },
  );
};
