// Los logs no contienen datos personales ni secretos (Fase 15): se capturan las líneas reales que escribe
// la aplicación con LOG_LEVEL=info durante un login, una búsqueda de clientes y una reserva pública.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { redactUrl } from '../src/lib/log.ts';
import { buildTestApp, createUser, login, TEST_PASSWORD } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { createTenantFixture, giveStandardHours, type TenantFixture } from './helpers/fixtures.ts';

const db = createTestDb();
const lines: string[] = [];
let app: FastifyInstance;
let f: TenantFixture;

beforeAll(async () => {
  await truncateAll(db);
  f = await createTenantFixture(db, 'barberia-log');
  await giveStandardHours(db, f);
  await createUser(db, f.tenantId, 'admin@log.test', 'ADMIN');
  app = await buildTestApp(db, () => new Date('2026-09-28T12:00:00Z'), { LOG_LEVEL: 'info' }, { write: (l) => void lines.push(l) });
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('logs sin datos personales', () => {
  it('no registran contraseñas, cookies, teléfonos ni búsquedas de clientes', async () => {
    await login(app, 'barberia-log', 'admin@log.test', 'contraseña-equivocada-123');
    const { cookie } = await login(app, 'barberia-log', 'admin@log.test');
    const search = await app.inject({ method: 'GET', url: '/api/v1/admin/customers?search=99876%205432&limit=5', headers: { cookie } });
    expect(search.statusCode).toBe(200);
    const booking = await app.inject({
      method: 'POST',
      url: '/api/v1/public/barberia-log/bookings',
      payload: { serviceId: f.serviceId, professionalId: 'any', date: '2026-09-29', time: '10:00', customer: { name: 'María Pérez', phone: '41 97777-1234' } },
    });
    expect(booking.statusCode).toBe(201);

    const log = lines.join('');
    expect(lines.length).toBeGreaterThan(4);
    expect(log).toContain('/api/v1/admin/customers?search=%5BREDACTED%5D&limit=5');
    for (const secret of [TEST_PASSWORD, 'contraseña-equivocada-123', cookie.slice(4), '99876', '97777', 'María']) {
      expect(log).not.toContain(secret);
    }
  });

  it('redactUrl solo toca los parámetros con datos personales', () => {
    expect(redactUrl('/api/v1/admin/customers')).toBe('/api/v1/admin/customers');
    expect(redactUrl('/x?date=2026-10-01&professionalId=any')).toBe('/x?date=2026-10-01&professionalId=any');
    expect(redactUrl('/x?search=Jo%C3%A3o&cursor=abc')).toBe('/x?search=%5BREDACTED%5D&cursor=abc');
  });
});
