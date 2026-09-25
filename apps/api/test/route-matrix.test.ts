// Matriz de permisos y aislamiento para TODAS las rutas del panel (Fase 14).
// La lista de rutas sale de la propia aplicación (app.routeList): si alguien añade una ruta /admin y no
// la clasifica aquí, este test falla. Así ninguna ruta nueva queda sin comprobar.
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { bookingData, createTenantFixture, giveStandardHours, type TenantFixture } from './helpers/fixtures.ts';

type Access = 'admin' | 'any';
type Resource = 'service' | 'professional' | 'location' | 'customer' | 'booking' | 'user' | 'timeBlock';

interface RouteSpec {
  /** Quién puede usarla: solo ADMIN, o ADMIN y PROFESSIONAL (limitado a lo suyo). */
  access: Access;
  /** Qué recurso identifica `:id` (para probar ids de otro negocio). */
  resource?: Resource;
  /** Cuerpo válido: con él la petición llega hasta la búsqueda del recurso. */
  body?: (f: TenantFixture) => object;
  query?: (f: TenantFixture) => string;
}

const FUTURE_DATE = '2026-10-01';
const SPEC: Record<string, RouteSpec> = {
  'GET /api/v1/admin/settings': { access: 'admin' },
  'PATCH /api/v1/admin/settings': { access: 'admin', body: () => ({ name: 'Cambiado' }) },
  'GET /api/v1/admin/settings/telegram': { access: 'admin' },
  'POST /api/v1/admin/settings/telegram/link': { access: 'admin' },
  'DELETE /api/v1/admin/settings/telegram': { access: 'admin' },
  'GET /api/v1/admin/services': { access: 'any' },
  'GET /api/v1/admin/services/:id': { access: 'any', resource: 'service' },
  'POST /api/v1/admin/services': { access: 'admin', body: () => ({ name: 'Nuevo', durationMinutes: 30, priceCents: 100 }) },
  'PATCH /api/v1/admin/services/:id': { access: 'admin', resource: 'service', body: () => ({ priceCents: 1 }) },
  'DELETE /api/v1/admin/services/:id': { access: 'admin', resource: 'service' },
  'GET /api/v1/admin/professionals': { access: 'any' },
  'GET /api/v1/admin/professionals/:id': { access: 'any', resource: 'professional' },
  'POST /api/v1/admin/professionals': { access: 'admin', body: () => ({ displayName: 'Nuevo' }) },
  'PATCH /api/v1/admin/professionals/:id': { access: 'admin', resource: 'professional', body: () => ({ displayName: 'Hackeado' }) },
  'DELETE /api/v1/admin/professionals/:id': { access: 'admin', resource: 'professional' },
  'PUT /api/v1/admin/professionals/:id/services': { access: 'admin', resource: 'professional', body: () => ({ serviceIds: [] }) },
  'GET /api/v1/admin/professionals/:id/working-hours': { access: 'any', resource: 'professional' },
  'PUT /api/v1/admin/professionals/:id/working-hours': { access: 'admin', resource: 'professional', body: () => ({ intervals: [] }) },
  'GET /api/v1/admin/locations': { access: 'any' },
  'GET /api/v1/admin/locations/:id': { access: 'any', resource: 'location' },
  'POST /api/v1/admin/locations': { access: 'admin', body: () => ({ name: 'Nuevo' }) },
  'PATCH /api/v1/admin/locations/:id': { access: 'admin', resource: 'location', body: () => ({ name: 'Hackeado' }) },
  'DELETE /api/v1/admin/locations/:id': { access: 'admin', resource: 'location' },
  'GET /api/v1/admin/time-blocks': { access: 'any' },
  'POST /api/v1/admin/time-blocks': {
    access: 'any',
    body: (f) => ({ professionalId: f.professionalId, startAt: '2026-10-05T12:00:00Z', endAt: '2026-10-05T13:00:00Z' }),
  },
  'DELETE /api/v1/admin/time-blocks/:id': { access: 'any', resource: 'timeBlock' },
  'GET /api/v1/admin/customers': { access: 'any' },
  'GET /api/v1/admin/customers/:id': { access: 'any', resource: 'customer' },
  'POST /api/v1/admin/customers': { access: 'admin', body: () => ({ name: 'Nuevo', phone: '41 91111-2222' }) },
  'PATCH /api/v1/admin/customers/:id': { access: 'admin', resource: 'customer', body: () => ({ name: 'Hackeado' }) },
  'GET /api/v1/admin/bookings': { access: 'any' },
  'GET /api/v1/admin/bookings/:id': { access: 'any', resource: 'booking' },
  'POST /api/v1/admin/bookings': {
    access: 'any',
    body: (f) => ({ serviceId: f.serviceId, professionalId: f.professionalId, date: FUTURE_DATE, time: '15:00', customer: { name: 'X', phone: '41 93333-4444' } }),
  },
  'PATCH /api/v1/admin/bookings/:id': { access: 'any', resource: 'booking', body: () => ({ date: FUTURE_DATE, time: '16:00' }) },
  'POST /api/v1/admin/bookings/:id/status': { access: 'any', resource: 'booking', body: () => ({ status: 'CANCELLED' }) },
  'GET /api/v1/admin/availability': { access: 'any', query: (f) => `?serviceId=${f.serviceId}&professionalId=any&date=${FUTURE_DATE}` },
  'GET /api/v1/admin/users': { access: 'admin' },
  'POST /api/v1/admin/users': { access: 'admin', body: () => ({ email: 'nuevo@x.test', role: 'PROFESSIONAL' }) },
  'PATCH /api/v1/admin/users/:id': { access: 'admin', resource: 'user', body: () => ({ active: false }) },
  'POST /api/v1/admin/users/:id/reset-password': { access: 'admin', resource: 'user' },
  'GET /api/v1/admin/audit-logs': { access: 'admin' },
  'GET /api/v1/admin/notifications': { access: 'admin' },
};

const db = createTestDb();
let app: FastifyInstance;
let a: TenantFixture;
let b: TenantFixture;
let adminA = '';
let proA = '';
const ids: Record<'b', Record<Resource, string>> = { b: {} as Record<Resource, string> };

beforeAll(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  b = await createTenantFixture(db, 'barberia-b');
  for (const f of [a, b]) await giveStandardHours(db, f);
  await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN');
  await createUser(db, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: a.professionalId });
  const userB = await createUser(db, b.tenantId, 'admin@b.test', 'ADMIN');
  const bookingB = await db.booking.create({ data: bookingData(b, new Date('2026-10-01T13:00:00Z')) });
  const blockB = await db.timeBlock.create({ data: { tenantId: b.tenantId, professionalId: b.professionalId, startAt: new Date('2026-10-02T12:00:00Z'), endAt: new Date('2026-10-02T13:00:00Z') } });
  ids.b = { service: b.serviceId, professional: b.professionalId, location: b.locationId, customer: b.customerId, booking: bookingB.id, user: userB.id, timeBlock: blockB.id };
  app = await buildTestApp(db, () => new Date('2026-09-30T12:00:00Z'));
  await app.ready();
  adminA = (await login(app, 'barberia-a', 'admin@a.test')).cookie;
  proA = (await login(app, 'barberia-a', 'carlos@a.test')).cookie;
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const adminRoutes = () => app.routeList.filter((r) => r.url.startsWith('/api/v1/admin')).map((r) => `${r.method} ${r.url}`);
const request = (key: string, opts: { cookie?: string; id?: string; body?: object | null }): Promise<LightMyRequestResponse> => {
  const [method, path] = key.split(' ') as [InjectOptions['method'], string];
  const spec = SPEC[key]!;
  const url = path.replace(':id', opts.id ?? '00000000-0000-4000-8000-000000000000') + (spec.query?.(a) ?? '');
  const body = opts.body === undefined ? spec.body?.(a) : opts.body;
  return app.inject({ method, url, headers: opts.cookie ? { cookie: opts.cookie } : {}, ...(body ? { payload: body } : {}) });
};
/** Estado de B para comprobar que nada cambió. */
const snapshotB = async () =>
  JSON.stringify(
    await Promise.all([
      db.service.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: 'asc' } }),
      db.professional.findMany({ where: { tenantId: b.tenantId }, include: { services: true, workingHours: true }, orderBy: { id: 'asc' } }),
      db.location.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: 'asc' } }),
      db.customer.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: 'asc' } }),
      db.booking.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: 'asc' } }),
      db.user.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: 'asc' } }),
      db.timeBlock.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: 'asc' } }),
      db.tenant.findUnique({ where: { id: b.tenantId } }),
    ]),
  );

describe('matriz de rutas del panel', () => {
  it('todas las rutas /admin están clasificadas (y no hay clasificaciones de rutas que ya no existen)', () => {
    expect(adminRoutes().sort()).toEqual(Object.keys(SPEC).sort());
  });

  it('sin sesión: 401 en TODAS las rutas, también con cuerpo inválido (no se revela el esquema)', async () => {
    for (const key of Object.keys(SPEC)) {
      const res = await request(key, { body: { basura: true } });
      expect(res.statusCode, key).toBe(401);
      expect(res.json().error.code, key).toBe('UNAUTHENTICATED');
    }
  });

  it('PROFESSIONAL: 403 en todas las rutas solo de ADMIN, también con cuerpo inválido', async () => {
    for (const [key, spec] of Object.entries(SPEC)) {
      if (spec.access !== 'admin') continue;
      const res = await request(key, { cookie: proA, body: { basura: true } });
      expect(res.statusCode, key).toBe(403);
    }
  });

  it('PROFESSIONAL no puede escalar su rol', async () => {
    const carlos = await db.user.findFirstOrThrow({ where: { email: 'carlos@a.test' } });
    const res = await request('PATCH /api/v1/admin/users/:id', { cookie: proA, id: carlos.id, body: { role: 'ADMIN' } });
    expect(res.statusCode).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: carlos.id } })).role).toBe('PROFESSIONAL');
  });

  it('ADMIN de A con ids de B: 404 en todas las rutas con :id y B no cambia', async () => {
    const before = await snapshotB();
    for (const [key, spec] of Object.entries(SPEC)) {
      if (!spec.resource) continue;
      const res = await request(key, { cookie: adminA, id: ids.b[spec.resource] });
      expect(res.statusCode, key).toBe(404);
    }
    expect(await snapshotB()).toBe(before);
  });

  it('PROFESSIONAL de A con ids de B: nunca accede (403 o 404) y B no cambia', async () => {
    const before = await snapshotB();
    for (const [key, spec] of Object.entries(SPEC)) {
      if (!spec.resource) continue;
      const res = await request(key, { cookie: proA, id: ids.b[spec.resource] });
      expect([403, 404], key).toContain(res.statusCode);
    }
    expect(await snapshotB()).toBe(before);
  });

  it('ninguna ruta acepta tenantId en el cuerpo', async () => {
    for (const [key, spec] of Object.entries(SPEC)) {
      if (!spec.body) continue;
      const res = await request(key, { cookie: adminA, id: ids.b.service, body: { ...spec.body(a), tenantId: b.tenantId } });
      expect(res.statusCode, key).toBe(400);
    }
    expect(await db.service.count({ where: { tenantId: b.tenantId } })).toBe(1);
  });

  it('los listados de A nunca contienen ids de B', async () => {
    const bIds = new Set(Object.values(ids.b));
    for (const [key, spec] of Object.entries(SPEC)) {
      if (!key.startsWith('GET') || spec.resource) continue;
      const res = await request(key, { cookie: adminA });
      expect(res.statusCode, key).toBe(200);
      for (const id of bIds) expect(res.body.includes(id), `${key} contiene ${id}`).toBe(false);
      expect(res.body.includes(b.tenantId), key).toBe(false);
    }
  });
});

describe('API pública y sesiones', () => {
  it('una sesión del panel de A no cambia nada en la API pública de B', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/barberia-b/bookings',
      headers: { cookie: adminA },
      payload: { serviceId: b.serviceId, professionalId: b.professionalId, date: '2026-10-05', time: '15:00', customer: { name: 'Web', phone: '41 94444-1111' } },
    });
    expect(res.statusCode).toBe(201);
    const booking = await db.booking.findUniqueOrThrow({ where: { id: res.json().booking.id } });
    expect(booking).toMatchObject({ tenantId: b.tenantId, source: 'PUBLIC_WEB', createdByUserId: null });
    // Y con la sesión de A no se puede reservar en B con datos de A.
    const cross = await app.inject({
      method: 'POST',
      url: '/api/v1/public/barberia-b/bookings',
      headers: { cookie: adminA },
      payload: { serviceId: a.serviceId, professionalId: a.professionalId, date: '2026-10-05', time: '16:00', customer: { name: 'Web', phone: '41 94444-2222' } },
    });
    expect(cross.statusCode).toBe(422);
  });

  it('20 reservas públicas simultáneas desde 20 clientes distintos al mismo hueco → 1 cita y 19 × 409', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/public/barberia-a/bookings',
          remoteAddress: `10.0.0.${i + 1}`,
          payload: { serviceId: a.serviceId, professionalId: a.professionalId, date: '2026-10-06', time: '11:00', customer: { name: `C${i}`, phone: `41 92222-${String(1000 + i)}` } },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, ...Array(19).fill(409)]);
    expect(await db.booking.count({ where: { tenantId: a.tenantId, startAt: new Date('2026-10-06T14:00:00Z') } })).toBe(1);
  });
});
