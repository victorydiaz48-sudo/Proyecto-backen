import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { bookingData, createTenantFixture, type TenantFixture } from './helpers/fixtures.ts';

const db = createTestDb();
const NOW = new Date('2026-10-01T12:00:00Z');
let app: FastifyInstance;
let a: TenantFixture;
let b: TenantFixture;
let adminA: string;
let proA: string;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  b = await createTenantFixture(db, 'barberia-b');
  await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN');
  await createUser(db, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: a.professionalId });
  app = await buildTestApp(db, () => NOW);
  adminA = (await login(app, 'barberia-a', 'admin@a.test')).cookie;
  proA = (await login(app, 'barberia-a', 'carlos@a.test')).cookie;
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.$disconnect();
});

const call = (cookie: string, method: InjectOptions['method'], url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

describe('locales', () => {
  it('crea un local y normaliza el WhatsApp a E.164 con el país del negocio', async () => {
    const res = await call(adminA, 'POST', '/locations', {
      name: 'Batel',
      address: 'Av. Batel, 1000',
      mapsUrl: 'https://maps.google.com/?q=batel',
      whatsapp: '(41) 99876-5432',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Batel', whatsapp: '+5541998765432', isDefault: false, active: true });
    expect((await call(adminA, 'POST', '/locations', { name: 'X', whatsapp: '123' })).statusCode).toBe(400);
    expect((await call(adminA, 'POST', '/locations', { name: 'X', mapsUrl: 'http://maps.example' })).statusCode).toBe(400);
  });

  it('siempre hay exactamente un local por defecto', async () => {
    const batel = (await call(adminA, 'POST', '/locations', { name: 'Batel', isDefault: true })).json();
    const list = (await call(adminA, 'GET', '/locations')).json().items;
    expect(list.filter((l: { isDefault: boolean }) => l.isDefault).map((l: { id: string }) => l.id)).toEqual([batel.id]);

    const unset = await call(adminA, 'PATCH', `/locations/${batel.id}`, { isDefault: false });
    expect(unset.statusCode).toBe(409);
    expect((await call(adminA, 'DELETE', `/locations/${batel.id}`)).statusCode).toBe(409);

    expect((await call(adminA, 'PATCH', `/locations/${a.locationId}`, { isDefault: true })).statusCode).toBe(200);
    expect(await db.location.count({ where: { tenantId: a.tenantId, isDefault: true } })).toBe(1);
  });

  it('no se desactiva un local con horarios o citas pendientes', async () => {
    const extra = (await call(adminA, 'POST', '/locations', { name: 'Batel' })).json();
    await db.workingHour.create({
      data: { tenantId: a.tenantId, professionalId: a.professionalId, locationId: extra.id, weekday: 1, startMinute: 540, endMinute: 600 },
    });
    const res = await call(adminA, 'DELETE', `/locations/${extra.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details).toEqual({ workingHours: 1, futureBookings: 0 });

    await db.workingHour.deleteMany();
    await db.booking.create({ data: bookingData({ ...a, locationId: extra.id }, new Date('2026-10-02T13:00:00Z')) });
    expect((await call(adminA, 'DELETE', `/locations/${extra.id}`)).json().error.details).toEqual({ workingHours: 0, futureBookings: 1 });

    await db.booking.updateMany({ data: { status: 'CANCELLED' } });
    const ok = await call(adminA, 'DELETE', `/locations/${extra.id}`);
    expect(ok.json().active).toBe(false);
    expect((await call(adminA, 'GET', '/locations')).json().items).toHaveLength(1);
  });

  it('PROFESSIONAL lee pero no modifica; A no ve ni toca los locales de B', async () => {
    expect((await call(proA, 'GET', '/locations')).statusCode).toBe(200);
    expect((await call(proA, 'POST', '/locations', { name: 'X' })).statusCode).toBe(403);
    expect((await call(proA, 'PATCH', `/locations/${a.locationId}`, { name: 'X' })).statusCode).toBe(403);
    for (const [method, payload] of [['GET'], ['PATCH', { name: 'Hackeado' }], ['DELETE']] as const) {
      expect((await call(adminA, method, `/locations/${b.locationId}`, payload)).statusCode, method).toBe(404);
    }
    expect((await db.location.findUniqueOrThrow({ where: { id: b.locationId } })).name).toBe('Principal');
    const ids = (await call(adminA, 'GET', '/locations?includeInactive=true')).json().items.map((l: { id: string }) => l.id);
    expect(ids).toEqual([a.locationId]);
  });
});
