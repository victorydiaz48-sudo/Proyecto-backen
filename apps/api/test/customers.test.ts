import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { bookingData, createTenantFixture, type TenantFixture } from './helpers/fixtures.ts';

const db = createTestDb();
let app: FastifyInstance;
let a: TenantFixture;
let b: TenantFixture;
let adminA: string;
let proA: string;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a'); // ya tiene a João (+5541998765432)
  b = await createTenantFixture(db, 'barberia-b');
  await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN');
  await createUser(db, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: a.professionalId });
  app = await buildTestApp(db);
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

describe('clientes', () => {
  it('crea con teléfono normalizado y detecta duplicados escritos de otra forma', async () => {
    const res = await call(adminA, 'POST', '/customers', { name: 'Maria', phone: '(41) 3333-4444', email: 'Maria@Mail.com' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Maria', phoneE164: '+554133334444', email: 'maria@mail.com' });

    const dup = await call(adminA, 'POST', '/customers', { name: 'Otro João', phone: '+55 41 99876-5432' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.details.customerId).toBe(a.customerId);
    expect((await call(adminA, 'POST', '/customers', { name: 'X', phone: '123' })).statusCode).toBe(400);
  });

  it('edita y no permite quedarse con el teléfono de otro cliente', async () => {
    const maria = (await call(adminA, 'POST', '/customers', { name: 'Maria', phone: '41 3333-4444' })).json();
    expect((await call(adminA, 'PATCH', `/customers/${maria.id}`, { notes: 'Prefere tesoura' })).json().notes).toBe('Prefere tesoura');
    expect((await call(adminA, 'PATCH', `/customers/${maria.id}`, { phone: '41 99876-5432' })).statusCode).toBe(409);
    expect(await db.auditLog.count({ where: { entityId: maria.id } })).toBe(2);
  });

  it('busca por nombre o por dígitos del teléfono y pagina con cursor', async () => {
    for (const [name, phone] of [['Ana', '41 3000-0001'], ['Bruno', '41 3000-0002'], ['Carla', '41 3000-0003']]) {
      await call(adminA, 'POST', '/customers', { name, phone });
    }
    expect((await call(adminA, 'GET', '/customers?search=bru')).json().items.map((c: { name: string }) => c.name)).toEqual(['Bruno']);
    expect((await call(adminA, 'GET', '/customers?search=3000-0003')).json().items.map((c: { name: string }) => c.name)).toEqual(['Carla']);
    const p1 = (await call(adminA, 'GET', '/customers?limit=2')).json();
    expect(p1.items.map((c: { name: string }) => c.name)).toEqual(['Ana', 'Bruno']);
    const p2 = (await call(adminA, 'GET', `/customers?limit=2&cursor=${p1.nextCursor}`)).json();
    expect(p2.items.map((c: { name: string }) => c.name)).toEqual(['Carla', 'João']);
    expect(p2.nextCursor).toBeNull();
  });

  it('PROFESSIONAL solo ve clientes con cita suya y no crea ni edita', async () => {
    const maria = (await call(adminA, 'POST', '/customers', { name: 'Maria', phone: '41 3333-4444' })).json();
    expect((await call(proA, 'GET', '/customers')).json().items).toEqual([]);
    await db.booking.create({ data: bookingData(a, new Date('2026-10-01T13:00:00Z')) });
    expect((await call(proA, 'GET', '/customers')).json().items.map((c: { id: string }) => c.id)).toEqual([a.customerId]);
    expect((await call(proA, 'GET', `/customers/${maria.id}`)).statusCode).toBe(404);
    expect((await call(proA, 'POST', '/customers', { name: 'X', phone: '41 3333-5555' })).statusCode).toBe(403);
    expect((await call(proA, 'PATCH', `/customers/${a.customerId}`, { name: 'X' })).statusCode).toBe(403);
  });

  it('el mismo teléfono en B es otro cliente; A no lo ve ni lo toca', async () => {
    expect((await call(adminA, 'GET', `/customers/${b.customerId}`)).statusCode).toBe(404);
    expect((await call(adminA, 'PATCH', `/customers/${b.customerId}`, { name: 'Hackeado' })).statusCode).toBe(404);
    expect((await call(adminA, 'GET', '/customers?search=99876')).json().items.map((c: { id: string }) => c.id)).toEqual([a.customerId]);
    expect((await db.customer.findUniqueOrThrow({ where: { id: b.customerId } })).name).toBe('João');
  });
});
