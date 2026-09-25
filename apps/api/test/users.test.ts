import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { createTenantFixture, type TenantFixture } from './helpers/fixtures.ts';

const db = createTestDb();
let app: FastifyInstance;
let a: TenantFixture;
let b: TenantFixture;
let adminAId: string;
let adminA: string;
let proA: string;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  b = await createTenantFixture(db, 'barberia-b');
  adminAId = (await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN')).id;
  await createUser(db, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: a.professionalId });
  await createUser(db, b.tenantId, 'admin@b.test', 'ADMIN');
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

describe('usuarios', () => {
  it('lista solo los usuarios del negocio, sin hashes', async () => {
    const res = await call(adminA, 'GET', '/users');
    const items = res.json().items;
    expect(items.map((u: { email: string }) => u.email).sort()).toEqual(['admin@a.test', 'carlos@a.test']);
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('argon2');
    expect(items.find((u: { email: string }) => u.email === 'carlos@a.test').professionalId).toBe(a.professionalId);
  });

  it('crea un profesional con contraseña temporal (se muestra una vez) y vinculado a su ficha', async () => {
    const pro = await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'André' } });
    const res = await call(adminA, 'POST', '/users', { email: 'Andre@A.test', role: 'PROFESSIONAL', professionalId: pro.id });
    expect(res.statusCode).toBe(201);
    const { user, temporaryPassword } = res.json();
    expect(user).toMatchObject({ email: 'andre@a.test', role: 'PROFESSIONAL', professionalId: pro.id });
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect((await login(app, 'barberia-a', 'andre@a.test', temporaryPassword)).res.statusCode).toBe(200);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'user.created' } });
    expect(JSON.stringify(log)).not.toContain(temporaryPassword);
  });

  it('valida: email duplicado, contraseña débil, ficha ya vinculada, ficha de B, ficha para un ADMIN', async () => {
    expect((await call(adminA, 'POST', '/users', { email: 'ADMIN@a.test', role: 'ADMIN' })).statusCode).toBe(409);
    expect((await call(adminA, 'POST', '/users', { email: 'x@a.test', role: 'ADMIN', password: '1234567890' })).statusCode).toBe(400);
    expect((await call(adminA, 'POST', '/users', { email: 'x@a.test', role: 'PROFESSIONAL', professionalId: a.professionalId })).statusCode).toBe(409);
    expect((await call(adminA, 'POST', '/users', { email: 'x@a.test', role: 'PROFESSIONAL', professionalId: b.professionalId })).statusCode).toBe(400);
    const free = await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'Livre' } });
    expect((await call(adminA, 'POST', '/users', { email: 'x@a.test', role: 'ADMIN', professionalId: free.id })).statusCode).toBe(400);
    expect((await call(adminA, 'POST', '/users', { email: 'x@a.test', role: 'OWNER' })).statusCode).toBe(400);
    expect(await db.user.count({ where: { tenantId: a.tenantId } })).toBe(2);
  });

  it('siempre queda al menos un ADMIN activo (ni degradarse ni desactivarse a sí mismo si es el último)', async () => {
    expect((await call(adminA, 'PATCH', `/users/${adminAId}`, { role: 'PROFESSIONAL' })).statusCode).toBe(409);
    expect((await call(adminA, 'PATCH', `/users/${adminAId}`, { active: false })).statusCode).toBe(409);
    const second = (await call(adminA, 'POST', '/users', { email: 'socio@a.test', role: 'ADMIN', password: 'otra-clave-larga-1' })).json().user;
    expect((await call(adminA, 'PATCH', `/users/${second.id}`, { active: false })).statusCode).toBe(200);
    expect((await call(adminA, 'PATCH', `/users/${adminAId}`, { active: false })).statusCode).toBe(409);
  });

  it('dos ADMIN que se degradan a la vez no dejan el negocio sin ADMIN', async () => {
    const second = (await call(adminA, 'POST', '/users', { email: 'socio@a.test', role: 'ADMIN', password: 'otra-clave-larga-1' })).json().user;
    // Cada uno se degrada a sí mismo con SU sesión: degradar corta las sesiones del afectado, así ninguna
    // petición depende de una sesión que la otra pueda cortar y ambas llegan al bloqueo del negocio.
    const secondSession = (await login(app, 'barberia-a', 'socio@a.test', 'otra-clave-larga-1')).cookie;
    // Para forzar la carrera: otra conexión bloquea las dos filas de usuario, así ambas peticiones leen el
    // número de ADMIN y esperan justo antes de escribir; luego se liberan a la vez. Sin el bloqueo del
    // negocio en el servicio, las dos se degradarían y el negocio quedaría sin ADMIN.
    const gate = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await gate.connect();
    await gate.query('BEGIN');
    await gate.query('SELECT id FROM "User" WHERE id = ANY($1::uuid[]) FOR UPDATE', [[adminAId, second.id]]);
    const pending = Promise.all([
      call(adminA, 'PATCH', `/users/${adminAId}`, { role: 'PROFESSIONAL' }),
      call(secondSession, 'PATCH', `/users/${second.id}`, { role: 'PROFESSIONAL' }),
    ]);
    // Con el bloqueo del negocio, una espera en la fila y la otra en el negocio: dos esperas en cualquier caso.
    for (let i = 0; i < 100; i++) {
      const { rows } = await gate.query<{ n: number }>(
        `SELECT count(DISTINCT pid)::int AS n FROM pg_locks WHERE NOT granted`,
      );
      if (rows[0]!.n >= 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await gate.query('COMMIT');
    await gate.end();
    const results = await pending;
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await db.user.count({ where: { tenantId: a.tenantId, role: 'ADMIN', active: true } })).toBe(1);
  });

  it('desactivar o cambiar de rol corta las sesiones; cambiar a ADMIN desvincula la ficha', async () => {
    const carlos = (await db.user.findFirstOrThrow({ where: { email: 'carlos@a.test' } })).id;
    await call(adminA, 'PATCH', `/users/${carlos}`, { role: 'ADMIN' });
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: proA } })).statusCode).toBe(401);
    expect((await db.professional.findUniqueOrThrow({ where: { id: a.professionalId } })).userId).toBeNull();
    await call(adminA, 'PATCH', `/users/${carlos}`, { role: 'PROFESSIONAL', professionalId: a.professionalId });
    const again = (await login(app, 'barberia-a', 'carlos@a.test')).cookie;
    await call(adminA, 'PATCH', `/users/${carlos}`, { active: false });
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: again } })).statusCode).toBe(401);
    expect((await login(app, 'barberia-a', 'carlos@a.test')).res.statusCode).toBe(401);
  });

  it('restablecer contraseña: temporal nueva, sesiones cerradas, auditado sin secreto', async () => {
    const carlos = (await db.user.findFirstOrThrow({ where: { email: 'carlos@a.test' } })).id;
    const res = await call(adminA, 'POST', `/users/${carlos}/reset-password`);
    const { temporaryPassword } = res.json();
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: proA } })).statusCode).toBe(401);
    expect((await login(app, 'barberia-a', 'carlos@a.test', temporaryPassword)).res.statusCode).toBe(200);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { action: 'user.password_reset' } }))).not.toContain(temporaryPassword);
  });

  it('PROFESSIONAL no gestiona usuarios; A no toca usuarios de B', async () => {
    expect((await call(proA, 'GET', '/users')).statusCode).toBe(403);
    expect((await call(proA, 'POST', '/users', { email: 'x@a.test', role: 'ADMIN' })).statusCode).toBe(403);
    const adminB = await db.user.findFirstOrThrow({ where: { tenantId: b.tenantId } });
    expect((await call(adminA, 'PATCH', `/users/${adminB.id}`, { active: false })).statusCode).toBe(404);
    expect((await call(adminA, 'POST', `/users/${adminB.id}/reset-password`)).statusCode).toBe(404);
    expect((await db.user.findUniqueOrThrow({ where: { id: adminB.id } })).active).toBe(true);
  });
});

describe('auditoría', () => {
  it('ADMIN lista la auditoría de su negocio, paginada y filtrable; nunca la de B', async () => {
    await call(adminA, 'PATCH', '/settings', { name: 'Uno' });
    await call(adminA, 'PATCH', '/settings', { name: 'Dos' });
    const bAdmin = (await login(app, 'barberia-b', 'admin@b.test')).cookie;
    await call(bAdmin, 'PATCH', '/settings', { name: 'De B' });

    const page = (await call(adminA, 'GET', '/audit-logs?action=tenant.settings_updated&limit=1')).json();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ action: 'tenant.settings_updated', actor: { email: 'admin@a.test' }, after: { name: 'Dos' } });
    const next = (await call(adminA, 'GET', `/audit-logs?action=tenant.settings_updated&limit=1&cursor=${page.nextCursor}`)).json();
    expect(next.items[0].after.name).toBe('Uno');
    expect(next.nextCursor).toBeNull();
    const all = (await call(adminA, 'GET', '/audit-logs?limit=100')).json().items;
    expect(all.some((l: { after: { name?: string } | null }) => l.after?.name === 'De B')).toBe(false);
    expect((await call(proA, 'GET', '/audit-logs')).statusCode).toBe(403);
  });
});
