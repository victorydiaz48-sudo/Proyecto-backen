// La aplicación arrancada con NODE_ENV=production (Fase 15): los controles de seguridad no dependen de
// que se esté en desarrollo o en test.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { createTenantFixture, type TenantFixture } from './helpers/fixtures.ts';

const db = createTestDb();
let app: FastifyInstance;
let f: TenantFixture;

beforeAll(async () => {
  await truncateAll(db);
  f = await createTenantFixture(db, 'barberia-prod');
  await createUser(db, f.tenantId, 'admin@prod.test', 'ADMIN');
  app = await buildTestApp(db, undefined, { NODE_ENV: 'production' });
  app.get('/boom', () => {
    throw new Error('detalle interno: DATABASE_URL=postgres://u:p@h/db');
  });
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('NODE_ENV=production', () => {
  it('cookie de sesión Secure, HttpOnly y SameSite=Strict', async () => {
    const { res } = await login(app, 'barberia-prod', 'admin@prod.test');
    const sid = res.cookies.find((c) => c.name === 'sid');
    expect(sid).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict', path: '/' });
  });

  it('cabeceras de seguridad en la API', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/barberia-prod' });
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('un 500 no revela detalles internos', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: expect.any(String) }, requestId: expect.any(String) });
    expect(res.body).not.toMatch(/postgres|DATABASE_URL|at /);
  });

  it('rate limit activo en la creación pública de citas (10/min por IP)', async () => {
    const hit = () =>
      app.inject({ method: 'POST', url: '/api/v1/public/barberia-prod/bookings', remoteAddress: '203.0.113.7', payload: {} });
    for (let i = 0; i < 10; i++) expect((await hit()).statusCode).toBe(400);
    const limited = await hit();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    // Otra IP no se ve afectada.
    const other = await app.inject({ method: 'POST', url: '/api/v1/public/barberia-prod/bookings', remoteAddress: '203.0.113.8', payload: {} });
    expect(other.statusCode).toBe(400);
  });

  it('rate limit activo en el login (20 intentos/15 min por IP)', async () => {
    // Un email distinto por intento: así no salta antes el bloqueo por cuenta (5 fallos).
    const hit = (i: number) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '198.51.100.9', payload: { tenantSlug: 'barberia-prod', email: `x${i}@prod.test`, password: 'mala-clave-123' } });
    for (let i = 0; i < 20; i++) expect((await hit(i)).statusCode).toBe(401);
    expect((await hit(20)).statusCode).toBe(429);
  });

  it('sin TRUST_PROXY, X-Forwarded-For no permite saltarse el rate limit', async () => {
    const hit = (xff: string) =>
      app.inject({ method: 'POST', url: '/api/v1/public/barberia-prod/bookings', remoteAddress: '203.0.113.50', headers: { 'x-forwarded-for': xff }, payload: {} });
    for (let i = 0; i < 10; i++) await hit(`10.0.0.${i}`);
    expect((await hit('10.0.0.99')).statusCode).toBe(429);
  });

  it('detrás de un proxy de confianza: la IP es la que añade el proxy, no la que escribe el cliente', async () => {
    const behindProxy = await buildTestApp(db, undefined, { NODE_ENV: 'production', TRUST_PROXY: '127.0.0.1' });
    // El balanceador (127.0.0.1) AÑADE la IP real al final de la cabecera que envió el cliente.
    const hit = (spoofed: string, real: string) =>
      behindProxy.inject({
        method: 'POST',
        url: '/api/v1/public/barberia-prod/bookings',
        remoteAddress: '127.0.0.1',
        headers: { 'x-forwarded-for': `${spoofed}, ${real}` },
        payload: {},
      });
    for (let i = 0; i < 10; i++) expect((await hit(`10.9.9.${i}`, '203.0.113.60')).statusCode).toBe(400);
    expect((await hit('10.9.9.99', '203.0.113.60')).statusCode).toBe(429);
    expect((await hit('10.9.9.99', '203.0.113.61')).statusCode).toBe(400); // otro cliente real
    await behindProxy.close();
  });
});
