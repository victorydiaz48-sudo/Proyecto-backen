import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers/app.ts';
import { createTestDb } from './helpers/db.ts';

// El panel React se sirve desde el mismo servidor que la API (un solo despliegue).
const db = createTestDb();
let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'admin-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div><script type="module" src="/assets/app-abc123.js"></script>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  app = await buildTestApp(db, undefined, { ADMIN_DIST_DIR: dir });
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('panel (SPA)', () => {
  it('sirve index.html en / y en cualquier ruta del panel, sin caché', async () => {
    for (const url of ['/', '/services', '/professionals/editar']) {
      const res = await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } });
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('los assets con hash llevan caché larga', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('las rutas /api inexistentes siguen devolviendo el 404 JSON, nunca el HTML', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nada', headers: { accept: 'text/html' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('la API sigue funcionando y con CSP estricta', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ status: 'ok' });
  });
});
