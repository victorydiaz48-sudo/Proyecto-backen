// Aislamiento entre tenants garantizado por la BD (claves foráneas compuestas (tenantId, id)):
// aunque el código de la aplicación tuviera un bug, no se pueden mezclar filas de A y B.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PgErrorCode } from '../src/db.ts';
import { createTestDb, expectPgError, truncateAll } from './helpers/db.ts';
import { at, bookingData, createTenantFixture, type TenantFixture } from './helpers/fixtures.ts';

const db = createTestDb();
let a: TenantFixture;
let b: TenantFixture;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  b = await createTenantFixture(db, 'barberia-b');
});
afterAll(async () => {
  await db.$disconnect();
});

describe('una cita del tenant A no puede referenciar entidades del tenant B', () => {
  const start = at('2026-10-01T13:00:00Z');
  for (const field of ['professionalId', 'serviceId', 'customerId', 'locationId'] as const) {
    it(`rechaza ${field} de otro tenant`, async () => {
      const code = await expectPgError(db.booking.create({ data: bookingData(a, start, { [field]: b[field] }) }));
      expect(code).toBe(PgErrorCode.FOREIGN_KEY_VIOLATION);
    });
  }

  it('rechaza createdByUserId de otro tenant', async () => {
    const userB = await db.user.create({
      data: { tenantId: b.tenantId, email: 'admin@b.test', passwordHash: 'h', role: 'ADMIN' },
    });
    const code = await expectPgError(db.booking.create({ data: bookingData(a, start, { createdByUserId: userB.id }) }));
    expect(code).toBe(PgErrorCode.FOREIGN_KEY_VIOLATION);
  });
});

describe('relaciones de configuración', () => {
  it('no se puede asignar a un profesional de A un servicio de B', async () => {
    const code = await expectPgError(
      db.professionalService.create({
        data: { tenantId: a.tenantId, professionalId: a.professionalId, serviceId: b.serviceId },
      }),
    );
    expect(code).toBe(PgErrorCode.FOREIGN_KEY_VIOLATION);
  });

  it('no se puede crear un horario de A en un local de B', async () => {
    const code = await expectPgError(
      db.workingHour.create({
        data: { tenantId: a.tenantId, professionalId: a.professionalId, locationId: b.locationId, weekday: 1, startMinute: 540, endMinute: 600 },
      }),
    );
    expect(code).toBe(PgErrorCode.FOREIGN_KEY_VIOLATION);
  });

  it('no se puede bloquear en A la agenda de un profesional de B', async () => {
    const code = await expectPgError(
      db.timeBlock.create({
        data: { tenantId: a.tenantId, professionalId: b.professionalId, startAt: at('2026-10-01T13:00:00Z'), endAt: at('2026-10-01T14:00:00Z') },
      }),
    );
    expect(code).toBe(PgErrorCode.FOREIGN_KEY_VIOLATION);
  });

  it('no se puede vincular un profesional de A a un usuario de B', async () => {
    const userB = await db.user.create({
      data: { tenantId: b.tenantId, email: 'pro@b.test', passwordHash: 'h', role: 'PROFESSIONAL' },
    });
    const code = await expectPgError(db.professional.update({ where: { id: a.professionalId }, data: { userId: userB.id } }));
    expect(code).toBe(PgErrorCode.FOREIGN_KEY_VIOLATION);
  });
});

describe('clientes', () => {
  it('el mismo teléfono en A y B son dos clientes independientes', async () => {
    const both = await db.customer.findMany({ where: { phoneE164: '+5541998765432' } });
    expect(new Set(both.map((c) => c.tenantId))).toEqual(new Set([a.tenantId, b.tenantId]));
  });

  it('el teléfono es único dentro del mismo tenant', async () => {
    const code = await expectPgError(
      db.customer.create({ data: { tenantId: a.tenantId, name: 'Otro', phoneE164: '+5541998765432' } }),
    );
    expect(code).toBe(PgErrorCode.UNIQUE_VIOLATION);
  });
});

describe('locales y usuarios', () => {
  it('solo un local por defecto por tenant (cada tenant tiene el suyo)', async () => {
    const code = await expectPgError(db.location.create({ data: { tenantId: a.tenantId, name: 'Otro', isDefault: true } }));
    expect(code).toBe(PgErrorCode.UNIQUE_VIOLATION);
    await db.location.create({ data: { tenantId: a.tenantId, name: 'Secundario' } });
  });

  it('el mismo email puede existir en tenants distintos, no dos veces en el mismo', async () => {
    const u = { email: 'admin@x.test', passwordHash: 'h', role: 'ADMIN' as const };
    await db.user.create({ data: { ...u, tenantId: a.tenantId } });
    await db.user.create({ data: { ...u, tenantId: b.tenantId } });
    expect(await expectPgError(db.user.create({ data: { ...u, tenantId: a.tenantId } }))).toBe(PgErrorCode.UNIQUE_VIOLATION);
  });
});
