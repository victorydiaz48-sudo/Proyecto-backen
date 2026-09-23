import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '../src/lib/crypto.ts';
import { buildTestApp, createUser, login, TEST_PASSWORD } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { createTenantFixture, type TenantFixture } from './helpers/fixtures.ts';

const db = createTestDb();
let app: FastifyInstance;
let a: TenantFixture;
let clock: Date;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN');
  clock = new Date('2026-10-01T12:00:00Z');
  app = await buildTestApp(db, () => clock);
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.$disconnect();
});

describe('POST /auth/login', () => {
  it('crea una sesión con cookie httpOnly + SameSite=Strict y guarda solo el hash del token', async () => {
    const { res } = await login(app, 'barberia-a', 'admin@a.test');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { email: 'admin@a.test', role: 'ADMIN' }, tenant: { slug: 'barberia-a' } });
    const c = res.cookies.find((x) => x.name === 'sid')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
    expect(c.path).toBe('/');
    const sessions = await db.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(sha256(c.value));
    expect(sessions[0]!.tokenHash).not.toBe(c.value);
  });

  it('no distingue mayúsculas en email ni slug', async () => {
    const { res } = await login(app, 'Barberia-A', 'ADMIN@A.test');
    expect(res.statusCode).toBe(200);
  });

  it('responde lo mismo con contraseña incorrecta, email inexistente o negocio inexistente', async () => {
    const bodies = await Promise.all([
      login(app, 'barberia-a', 'admin@a.test', 'otra-contraseña-mala'),
      login(app, 'barberia-a', 'nadie@a.test'),
      login(app, 'no-existe', 'admin@a.test'),
    ]);
    for (const { res } of bodies) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
      expect(res.cookies).toHaveLength(0);
    }
    const audits = await db.auditLog.findMany({ where: { action: 'auth.login_failed' } });
    expect(audits).toHaveLength(2); // los dos intentos contra un tenant existente
    expect(JSON.stringify(audits)).not.toContain('otra-contraseña-mala');
  });

  it('rechaza usuarios desactivados y tenants suspendidos', async () => {
    await db.user.updateMany({ data: { active: false } });
    expect((await login(app, 'barberia-a', 'admin@a.test')).res.statusCode).toBe(401);
    await db.user.updateMany({ data: { active: true } });
    await db.tenant.update({ where: { id: a.tenantId }, data: { status: 'SUSPENDED' } });
    expect((await login(app, 'barberia-a', 'admin@a.test')).res.statusCode).toBe(401);
  });

  it('bloquea tras 5 fallos para el mismo negocio+email, aunque luego acierte', async () => {
    for (let i = 0; i < 5; i++) await login(app, 'barberia-a', 'admin@a.test', 'mala-mala-mala');
    const { res } = await login(app, 'barberia-a', 'admin@a.test');
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
    clock = new Date(clock.getTime() + 16 * 60 * 1000);
    expect((await login(app, 'barberia-a', 'admin@a.test')).res.statusCode).toBe(200);
  });

  it('limita las peticiones de login por IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await login(app, 'barberia-a', `x${i}@a.test`)).res.statusCode);
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
  });

  it('valida el cuerpo y rechaza campos desconocidos como tenantId o role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'barberia-a', email: 'admin@a.test', password: TEST_PASSWORD, role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('solo acepta JSON (text/plain se rechaza: evita CSRF con peticiones simples)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify({ tenantSlug: 'barberia-a', email: 'admin@a.test', password: TEST_PASSWORD }),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});

describe('sesión', () => {
  it('GET /auth/me sin sesión → 401; con sesión → usuario y tenant', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    const { cookie } = await login(app, 'barberia-a', 'admin@a.test');
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().tenant.slug).toBe('barberia-a');
  });

  it('una cookie inventada no da acceso', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: 'sid=inventada' } });
    expect(res.statusCode).toBe(401);
  });

  it('caduca tras 7 días sin uso y se renueva con el uso, hasta un máximo de 30 días', async () => {
    const { cookie } = await login(app, 'barberia-a', 'admin@a.test');
    const me = () => app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    for (let day = 6; day <= 29; day += 6) {
      clock = new Date(Date.parse('2026-10-01T12:00:00Z') + day * 86_400_000);
      expect((await me()).statusCode, `día ${day}`).toBe(200);
    }
    clock = new Date(Date.parse('2026-10-01T12:00:00Z') + 30 * 86_400_000 + 1000);
    expect((await me()).statusCode).toBe(401);
  });

  it('una sesión sin uso durante más de 7 días caduca', async () => {
    const { cookie } = await login(app, 'barberia-a', 'admin@a.test');
    clock = new Date(clock.getTime() + 7 * 86_400_000 + 1000);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('logout revoca la sesión en la BD', async () => {
    const { cookie } = await login(app, 'barberia-a', 'admin@a.test');
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(await db.session.count()).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('suspender el tenant corta las sesiones abiertas', async () => {
    const { cookie } = await login(app, 'barberia-a', 'admin@a.test');
    await db.tenant.update({ where: { id: a.tenantId }, data: { status: 'SUSPENDED' } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('POST /auth/password', () => {
  it('exige la contraseña actual, aplica la política y cierra las demás sesiones', async () => {
    const s1 = await login(app, 'barberia-a', 'admin@a.test');
    const s2 = await login(app, 'barberia-a', 'admin@a.test');
    const change = (cookie: string, payload: object) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/password', headers: { cookie }, payload });

    expect((await change(s1.cookie, { currentPassword: 'incorrecta-123', newPassword: 'nueva-clave-segura-1' })).statusCode).toBe(400);
    const weak = await change(s1.cookie, { currentPassword: TEST_PASSWORD, newPassword: 'corta' });
    expect(weak.json().error.code).toBe('VALIDATION_ERROR');

    const ok = await change(s1.cookie, { currentPassword: TEST_PASSWORD, newPassword: 'nueva-clave-segura-1' });
    expect(ok.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s1.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s2.cookie } })).statusCode).toBe(401);
    expect((await login(app, 'barberia-a', 'admin@a.test', 'nueva-clave-segura-1')).res.statusCode).toBe(200);
  });
});

describe('CSRF', () => {
  it('rechaza peticiones que modifican estado desde otro origen', async () => {
    const { cookie } = await login(app, 'barberia-a', 'admin@a.test');
    const cross = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: 'https://malicioso.example', host: 'reservas.example' },
    });
    expect(cross.statusCode).toBe(403);
    expect(cross.json().error.code).toBe('CSRF_REJECTED');
    const site = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, 'sec-fetch-site': 'cross-site' },
    });
    expect(site.statusCode).toBe(403);
    const same = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: 'https://reservas.example', host: 'reservas.example', 'sec-fetch-site': 'same-origin' },
    });
    expect(same.statusCode).toBe(204);
  });
});

describe('errores', () => {
  it('ruta inexistente → 404 con el formato uniforme y requestId', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nada' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' }, requestId: expect.any(String) });
  });

  it('healthz y readyz', async () => {
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ method: 'GET', url: '/readyz' })).json()).toEqual({ status: 'ok' });
  });
});
