// Roles y aislamiento entre tenants a través de la API (además de las garantías de BD).
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { createTenantFixture, type TenantFixture } from './helpers/fixtures.ts';

const db = createTestDb();
let app: FastifyInstance;
let a: TenantFixture;
let b: TenantFixture;
let adminA: string;
let proA: string;
let adminB: string;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  b = await createTenantFixture(db, 'barberia-b');
  await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN');
  await createUser(db, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: a.professionalId });
  // Mismo email en B: el login depende del negocio elegido.
  await createUser(db, b.tenantId, 'admin@a.test', 'ADMIN');
  app = await buildTestApp(db);
  adminA = (await login(app, 'barberia-a', 'admin@a.test')).cookie;
  proA = (await login(app, 'barberia-a', 'carlos@a.test')).cookie;
  adminB = (await login(app, 'barberia-b', 'admin@a.test')).cookie;
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.$disconnect();
});

const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const patch = (cookie: string, url: string, payload: object) =>
  app.inject({ method: 'PATCH', url, headers: { cookie }, payload });

describe('roles', () => {
  it('sin sesión todo /admin responde 401', async () => {
    for (const [method, url] of [['GET', '/api/v1/admin/settings'], ['PATCH', '/api/v1/admin/settings']] as const) {
      const res = await app.inject({ method, url, payload: method === 'PATCH' ? { name: 'x' } : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('PROFESSIONAL no puede ver ni cambiar los ajustes del negocio', async () => {
    expect((await get(proA, '/api/v1/admin/settings')).statusCode).toBe(403);
    const res = await patch(proA, '/api/v1/admin/settings', { defaultBookingStatus: 'PENDING' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect((await db.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).defaultBookingStatus).toBe('CONFIRMED');
  });

  it('/auth/me de un PROFESSIONAL incluye su professionalId (sale de la BD)', async () => {
    const me = (await get(proA, '/api/v1/auth/me')).json();
    expect(me.user).toMatchObject({ role: 'PROFESSIONAL', professionalId: a.professionalId });
  });

  it('ADMIN cambia los ajustes y queda auditado con antes/después', async () => {
    const res = await patch(adminA, '/api/v1/admin/settings', { defaultBookingStatus: 'PENDING', slotIntervalMinutes: 30 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ defaultBookingStatus: 'PENDING', slotIntervalMinutes: 30 });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'tenant.settings_updated' } });
    expect(log).toMatchObject({ tenantId: a.tenantId, before: { defaultBookingStatus: 'CONFIRMED' }, after: { defaultBookingStatus: 'PENDING' } });
  });

  it('valida los ajustes (zona horaria, estado inicial, rangos)', async () => {
    for (const bad of [
      { timezone: 'Marte/Olympus' },
      { defaultBookingStatus: 'COMPLETED' },
      { slotIntervalMinutes: 1 },
      { slug: 'otro-slug' },
      {},
    ]) {
      const res = await patch(adminA, '/api/v1/admin/settings', bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe('aislamiento entre tenants por la API', () => {
  it('cada ADMIN ve solo los ajustes de su propio negocio, aunque tengan el mismo email', async () => {
    expect((await get(adminA, '/api/v1/admin/settings')).json().slug).toBe('barberia-a');
    expect((await get(adminB, '/api/v1/admin/settings')).json().slug).toBe('barberia-b');
  });

  it('no se puede apuntar a otro tenant con tenantId en el cuerpo', async () => {
    const res = await patch(adminA, '/api/v1/admin/settings', { tenantId: b.tenantId, name: 'Hackeado' });
    expect(res.statusCode).toBe(400);
    const names = (await db.tenant.findMany({ orderBy: { slug: 'asc' } })).map((t) => t.name);
    expect(names).toEqual(['barberia-a', 'barberia-b']);
  });

  it('la cabecera x-tenant-id o un query param no cambian el tenant de la sesión', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/settings?tenantId=${b.tenantId}`,
      headers: { cookie: adminA, 'x-tenant-id': b.tenantId },
      payload: { name: 'Nuevo A' },
    });
    expect(res.statusCode).toBe(200);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).name).toBe('Nuevo A');
    expect((await db.tenant.findUniqueOrThrow({ where: { id: b.tenantId } })).name).toBe('barberia-b');
  });

  it('las credenciales de A no sirven para entrar en B', async () => {
    const { res } = await login(app, 'barberia-b', 'carlos@a.test');
    expect(res.statusCode).toBe(401);
  });
});

describe('errores internos', () => {
  it('un 500 no revela el mensaje ni la pila', async () => {
    const fresh = await buildTestApp(db);
    fresh.get('/boom', () => {
      throw new Error('detalle interno: password=secreto');
    });
    const res = await fresh.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: 'INTERNAL' } });
    expect(res.body).not.toContain('secreto');
    expect(res.body).not.toContain('at ');
    await fresh.close();
  });
});
