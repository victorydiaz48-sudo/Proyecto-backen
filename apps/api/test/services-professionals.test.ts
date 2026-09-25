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

describe('servicios', () => {
  it('ADMIN crea, lee, edita y archiva; queda auditado', async () => {
    const created = await call(adminA, 'POST', '/services', { name: ' Barba ', durationMinutes: 20, priceCents: 3000 });
    expect(created.statusCode).toBe(201);
    const s = created.json();
    expect(s).toMatchObject({ name: 'Barba', durationMinutes: 20, priceCents: 3000, bufferAfterMinutes: 0, active: true, description: null });

    expect((await call(adminA, 'GET', `/services/${s.id}`)).json().name).toBe('Barba');
    const patched = await call(adminA, 'PATCH', `/services/${s.id}`, { priceCents: 3500, description: 'Com toalha quente' });
    expect(patched.json()).toMatchObject({ priceCents: 3500, description: 'Com toalha quente' });
    expect((await call(adminA, 'PATCH', `/services/${s.id}`, { description: '' })).json().description).toBeNull();

    const archived = await call(adminA, 'DELETE', `/services/${s.id}`);
    expect(archived.json().active).toBe(false);
    const names = (await call(adminA, 'GET', '/services')).json().items.map((x: { name: string }) => x.name);
    expect(names).toEqual(['Corte']);
    const all = (await call(adminA, 'GET', '/services?includeInactive=true')).json().items;
    expect(all).toHaveLength(2);

    const actions = (await db.auditLog.findMany({ where: { entityId: s.id }, orderBy: { createdAt: 'asc' } })).map((l) => l.action);
    expect(actions).toEqual(['service.created', 'service.updated', 'service.updated', 'service.updated']);
  });

  it('nombre duplicado entre activos → 409 (sin distinguir mayúsculas), también al reactivar', async () => {
    const dup = await call(adminA, 'POST', '/services', { name: 'CORTE', durationMinutes: 30, priceCents: 1 });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CONFLICT');

    await call(adminA, 'DELETE', `/services/${a.serviceId}`);
    expect((await call(adminA, 'POST', '/services', { name: 'Corte', durationMinutes: 30, priceCents: 1 })).statusCode).toBe(201);
    expect((await call(adminA, 'PATCH', `/services/${a.serviceId}`, { active: true })).statusCode).toBe(409);
  });

  it('valida duración, precio y campos que el cliente no puede fijar', async () => {
    for (const bad of [
      { name: 'X', durationMinutes: 4, priceCents: 100 },
      { name: 'X', durationMinutes: 601, priceCents: 100 },
      { name: 'X', durationMinutes: 30, priceCents: -1 },
      { name: 'X', durationMinutes: 30, priceCents: 45.5 },
      { name: 'X', durationMinutes: 30, priceCents: '4500' },
      { name: '', durationMinutes: 30, priceCents: 100 },
      { name: 'X', durationMinutes: 30, priceCents: 100, tenantId: b.tenantId },
      { name: 'X', durationMinutes: 30, priceCents: 100, active: false },
    ]) {
      const res = await call(adminA, 'POST', '/services', bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect(await db.service.count({ where: { tenantId: a.tenantId } })).toBe(1);
  });

  it('cambiar precio o duración no altera las citas ya creadas (guardan su copia)', async () => {
    await db.booking.create({ data: bookingData(a, new Date('2026-10-02T13:00:00Z')) });
    await call(adminA, 'PATCH', `/services/${a.serviceId}`, { priceCents: 9900, durationMinutes: 60 });
    const booking = await db.booking.findFirstOrThrow();
    expect(booking).toMatchObject({ priceCentsSnapshot: 4500, durationMinutesSnapshot: 30 });
  });

  it('PROFESSIONAL puede leer pero no modificar', async () => {
    expect((await call(proA, 'GET', '/services')).statusCode).toBe(200);
    expect((await call(proA, 'GET', `/services/${a.serviceId}`)).statusCode).toBe(200);
    expect((await call(proA, 'POST', '/services', { name: 'X', durationMinutes: 30, priceCents: 1 })).statusCode).toBe(403);
    expect((await call(proA, 'PATCH', `/services/${a.serviceId}`, { priceCents: 1 })).statusCode).toBe(403);
    expect((await call(proA, 'DELETE', `/services/${a.serviceId}`)).statusCode).toBe(403);
    expect((await db.service.findUniqueOrThrow({ where: { id: a.serviceId } })).priceCents).toBe(4500);
  });
});

describe('profesionales', () => {
  it('ADMIN crea un profesional con sus servicios y los reemplaza', async () => {
    const barba = (await call(adminA, 'POST', '/services', { name: 'Barba', durationMinutes: 20, priceCents: 3000 })).json();
    const res = await call(adminA, 'POST', '/professionals', {
      displayName: 'André',
      title: 'Barbeiro',
      photoUrl: 'https://cdn.example/andre.jpg',
      serviceIds: [a.serviceId, barba.id, a.serviceId],
    });
    expect(res.statusCode).toBe(201);
    const andre = res.json();
    expect(andre).toMatchObject({ displayName: 'André', title: 'Barbeiro', active: true, userId: null });
    expect(andre.serviceIds.sort()).toEqual([a.serviceId, barba.id].sort());

    const onlyBeard = await call(adminA, 'PUT', `/professionals/${andre.id}/services`, { serviceIds: [barba.id] });
    expect(onlyBeard.json().serviceIds).toEqual([barba.id]);
    expect((await call(adminA, 'PUT', `/professionals/${andre.id}/services`, { serviceIds: [] })).json().serviceIds).toEqual([]);

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'professional.services_updated' }, orderBy: { createdAt: 'asc' } });
    expect(log.after).toEqual({ serviceIds: [barba.id] });
  });

  it('filtra por servicio y oculta inactivos salvo que se pidan', async () => {
    const other = await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'Zé', active: false } });
    const list = (await call(adminA, 'GET', `/professionals?serviceId=${a.serviceId}`)).json().items;
    expect(list.map((p: { id: string }) => p.id)).toEqual([a.professionalId]);
    const all = (await call(adminA, 'GET', '/professionals?includeInactive=true')).json().items;
    expect(all.map((p: { id: string }) => p.id).sort()).toEqual([a.professionalId, other.id].sort());
  });

  it('valida nombre, foto https y campos no permitidos (userId, tenantId)', async () => {
    for (const bad of [
      { displayName: '' },
      { displayName: 'X', photoUrl: 'http://inseguro.example/x.jpg' },
      { displayName: 'X', photoUrl: 'javascript:alert(1)' },
      { displayName: 'X', userId: a.professionalId },
      { displayName: 'X', tenantId: b.tenantId },
      { displayName: 'X', serviceIds: ['no-es-uuid'] },
    ]) {
      expect((await call(adminA, 'POST', '/professionals', bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('no se puede desactivar con citas futuras activas; sí con solo citas pasadas o canceladas', async () => {
    const future = await db.booking.create({ data: bookingData(a, new Date('2026-10-02T13:00:00Z')) });
    await db.booking.create({ data: bookingData(a, new Date('2026-09-20T13:00:00Z')) });
    const blocked = await call(adminA, 'DELETE', `/professionals/${a.professionalId}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details).toEqual({ futureBookings: 1 });
    expect((await call(adminA, 'PATCH', `/professionals/${a.professionalId}`, { active: false })).statusCode).toBe(409);

    await db.booking.update({ where: { id: future.id }, data: { status: 'CANCELLED' } });
    const ok = await call(adminA, 'DELETE', `/professionals/${a.professionalId}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().active).toBe(false);
  });

  it('PROFESSIONAL puede leer pero no crear, editar ni cambiar servicios (ni los suyos)', async () => {
    expect((await call(proA, 'GET', '/professionals')).statusCode).toBe(200);
    expect((await call(proA, 'POST', '/professionals', { displayName: 'X' })).statusCode).toBe(403);
    expect((await call(proA, 'PATCH', `/professionals/${a.professionalId}`, { displayName: 'Yo' })).statusCode).toBe(403);
    expect((await call(proA, 'PUT', `/professionals/${a.professionalId}/services`, { serviceIds: [] })).statusCode).toBe(403);
  });
});

describe('aislamiento entre tenants', () => {
  it('con ids de B, el ADMIN de A recibe 404 en todo y B no cambia', async () => {
    const requests: [InjectOptions['method'], string, object?][] = [
      ['GET', `/services/${b.serviceId}`],
      ['PATCH', `/services/${b.serviceId}`, { priceCents: 1 }],
      ['DELETE', `/services/${b.serviceId}`],
      ['GET', `/professionals/${b.professionalId}`],
      ['PATCH', `/professionals/${b.professionalId}`, { displayName: 'Hackeado' }],
      ['DELETE', `/professionals/${b.professionalId}`],
      ['PUT', `/professionals/${b.professionalId}/services`, { serviceIds: [] }],
    ];
    for (const [method, url, payload] of requests) {
      const res = await call(adminA, method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    }
    const svcB = await db.service.findUniqueOrThrow({ where: { id: b.serviceId } });
    expect(svcB).toMatchObject({ priceCents: 4500, active: true });
    const proB = await db.professional.findUniqueOrThrow({ where: { id: b.professionalId }, include: { services: true } });
    expect(proB).toMatchObject({ displayName: 'Carlos', active: true });
    expect(proB.services).toHaveLength(1);
    expect(await db.auditLog.count({ where: { tenantId: b.tenantId } })).toBe(0);
  });

  it('no se pueden asignar servicios de B a un profesional de A (mismo error que un id inexistente)', async () => {
    const fromB = await call(adminA, 'PUT', `/professionals/${a.professionalId}/services`, { serviceIds: [b.serviceId] });
    const missing = await call(adminA, 'PUT', `/professionals/${a.professionalId}/services`, {
      serviceIds: ['00000000-0000-4000-8000-000000000000'],
    });
    expect(fromB.statusCode).toBe(400);
    expect(fromB.json().error).toEqual(missing.json().error);
    expect((await call(adminA, 'POST', '/professionals', { displayName: 'X', serviceIds: [b.serviceId] })).statusCode).toBe(400);
    expect(await db.professional.count({ where: { tenantId: a.tenantId } })).toBe(1);
    const own = await db.professionalService.findMany({ where: { professionalId: a.professionalId } });
    expect(own.map((x) => x.serviceId)).toEqual([a.serviceId]);
  });

  it('los listados de A nunca incluyen filas de B', async () => {
    const svc = (await call(adminA, 'GET', '/services?includeInactive=true')).json().items;
    const pros = (await call(adminA, 'GET', '/professionals?includeInactive=true')).json().items;
    expect(svc.map((s: { id: string }) => s.id)).toEqual([a.serviceId]);
    expect(pros.map((p: { id: string }) => p.id)).toEqual([a.professionalId]);
    expect((await call(adminA, 'GET', `/professionals?serviceId=${b.serviceId}`)).json().items).toEqual([]);
  });
});
