// /operator: alta de negocios desde el navegador (sin terminal), protegida por OPERATOR_TOKEN.
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';

const TOKEN = 'token-de-operador-muy-largo-0123456789';
const db = createTestDb();
let app: FastifyInstance;
let ip = 0;

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const valid = {
  token: TOKEN,
  name: 'Barbearia Móvil',
  slug: 'barbearia-movil',
  adminEmail: 'Dono@Movil.test',
  timezone: 'America/Sao_Paulo',
  country: '55',
  currency: 'brl',
  locale: 'pt-BR',
  location: 'Centro',
};
const post = (fields: Record<string, string>, remoteAddress = `203.0.113.${++ip}`) =>
  app.inject({
    method: 'POST',
    url: '/operator/tenants',
    remoteAddress,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form(fields),
  });

beforeEach(async () => {
  await truncateAll(db);
  app = await buildTestApp(db, undefined, { OPERATOR_TOKEN: TOKEN });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.$disconnect();
});

describe('/operator', () => {
  it('sin OPERATOR_TOKEN no existe (404)', async () => {
    const off = await buildTestApp(db);
    expect((await off.inject({ method: 'GET', url: '/operator' })).statusCode).toBe(404);
    expect((await off.inject({ method: 'POST', url: '/operator/tenants', payload: form(valid), headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(404);
    await off.close();
  });

  it('OPERATOR_TOKEN corto → la configuración no se acepta', async () => {
    await expect(buildTestApp(db, undefined, { OPERATOR_TOKEN: 'corto' })).rejects.toThrow(/OPERATOR_TOKEN/);
  });

  it('muestra el formulario sin JavaScript, sin caché y con la CSP', async () => {
    const res = await app.inject({ method: 'GET', url: '/operator' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.body).toContain('action="/operator/tenants"');
    expect(res.body).not.toContain('<script');
  });

  it('crea el negocio con su ADMIN y muestra la contraseña inicial una vez; con ella se entra al panel', async () => {
    const res = await post(valid);
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const password = /Contraseña inicial: <code>([^<]+)<\/code>/.exec(res.body)?.[1];
    expect(password).toBeTruthy();
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: 'barbearia-movil' } });
    expect(tenant).toMatchObject({ name: 'Barbearia Móvil', currency: 'BRL', timezone: 'America/Sao_Paulo', defaultCountryCode: '55' });
    expect(await db.location.findFirstOrThrow({ where: { tenantId: tenant.id } })).toMatchObject({ name: 'Centro', isDefault: true });
    expect(await db.auditLog.count({ where: { tenantId: tenant.id, action: 'tenant.provisioned', actorType: 'SYSTEM' } })).toBe(1);
    expect((await login(app, 'barbearia-movil', 'dono@movil.test', password)).res.statusCode).toBe(200);
  });

  it('token incorrecto o ausente → 403 y no se crea nada', async () => {
    expect((await post({ ...valid, token: 'otro-token-de-operador-muy-largo-000000' })).statusCode).toBe(403);
    const { token: _omit, ...withoutToken } = valid;
    expect((await post(withoutToken)).statusCode).toBe(403);
    expect(await db.tenant.count()).toBe(0);
  });

  it('errores de validación junto a cada campo, sin perder lo escrito; el HTML se escapa', async () => {
    const res = await post({ ...valid, slug: 'Mal Slug', timezone: 'Marte/Olympus', name: '<script>alert(1)</script>' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('class="err"');
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.body).not.toContain('<script>alert(1)');
    expect(res.body).toContain('value="Marte/Olympus"');
    expect(await db.tenant.count()).toBe(0);
  });

  it('slug repetido → 409 con el mensaje', async () => {
    expect((await post(valid)).statusCode).toBe(201);
    const again = await post({ ...valid, adminEmail: 'otro@movil.test' });
    expect(again.statusCode).toBe(409);
    expect(again.body).toContain('Ya existe un negocio con ese slug');
  });

  it('límite de intentos por IP (10 cada 15 min), también con token incorrecto', async () => {
    for (let i = 0; i < 10; i++) expect((await post({ ...valid, token: 'x' }, '198.51.100.77')).statusCode).toBe(403);
    expect((await post(valid, '198.51.100.77')).statusCode).toBe(429);
    expect(await db.tenant.count()).toBe(0);
  });

  it('el resto de la API sigue sin aceptar formularios (solo JSON)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ tenantSlug: 'x', email: 'a@b.c', password: 'y' }),
    });
    expect(res.statusCode).toBe(415);
  });
});
