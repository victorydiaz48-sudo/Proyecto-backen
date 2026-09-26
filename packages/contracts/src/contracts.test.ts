import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { roleAtLeast } from './common.js';
import { buildOpenApiDocument } from './openapi.js';
import { loginBody, settingsPatch, vehiclePatch } from './resources.js';
import { ROUTES, type RouteContract } from './routes.js';

const routes = ROUTES as readonly RouteContract[];

describe('route table', () => {
  it('has unique ids and unique method+path pairs', () => {
    expect(new Set(routes.map((r) => r.id)).size).toBe(routes.length);
    expect(new Set(routes.map((r) => `${r.method} ${r.path}`)).size).toBe(routes.length);
  });

  it('declares a params schema matching every :param in the path', () => {
    for (const r of routes) {
      const names = [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
      expect(Object.keys(r.params?.shape ?? {}).sort(), r.id).toEqual(names.sort());
    }
  });

  it('only exposes login, health and readiness without a session', () => {
    expect(routes.filter((r) => r.auth === 'public').map((r) => r.id).sort()).toEqual(['auth.login', 'system.health', 'system.ready']);
  });

  it('keeps sensitive operations at ADMIN or above', () => {
    for (const id of ['settings.update', 'apiKeys.put', 'apiKeys.delete', 'users.create', 'integrations.test', 'audit.list']) {
      const r = routes.find((x) => x.id === id)!;
      expect(r.auth !== 'public' && roleAtLeast(r.auth, 'ADMIN'), id).toBe(true);
    }
  });

  it('never accepts a organizationId from the client', () => {
    const doc = JSON.stringify(buildOpenApiDocument().paths);
    expect(doc).not.toContain('organizationId');
  });
});

describe('roles', () => {
  it('orders OWNER > ADMIN > EDITOR > OPERATOR', () => {
    expect(roleAtLeast('OWNER', 'ADMIN')).toBe(true);
    expect(roleAtLeast('EDITOR', 'ADMIN')).toBe(false);
    expect(roleAtLeast('OPERATOR', 'OPERATOR')).toBe(true);
  });
});

describe('input validation', () => {
  it('rejects malformed input', () => {
    expect(loginBody.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(vehiclePatch.safeParse({ mileageKm: -5 }).success).toBe(false);
    expect(vehiclePatch.safeParse({ year: 1800 }).success).toBe(false);
    expect(settingsPatch.safeParse({ website: 'javascript:alert(1)' }).success).toBe(false);
    expect(settingsPatch.safeParse({ website: 'data:text/html,hi' }).success).toBe(false);
    expect(settingsPatch.safeParse({ website: 'https://autos-silva.com.br' }).success).toBe(true);
    expect(settingsPatch.safeParse({ currency: 'eur' }).success).toBe(false);
    expect(settingsPatch.safeParse({ locale: 'pt', currency: 'BRL' }).success).toBe(true);
  });
});

describe('OpenAPI document', () => {
  it('is up to date (run `pnpm --filter @autocontent/contracts generate:openapi`)', () => {
    const committed = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'api', 'openapi.json'), 'utf8');
    expect(JSON.parse(committed)).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });
});
