// Row-Level Security (Fase 15): la BD aísla los negocios aunque una consulta olvide filtrar por tenantId.
// Todo se ejecuta con el rol de la aplicación (reservas_app), como en producción; los datos se preparan
// con el propietario (no sujeto a RLS).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rlsBypassReason, type Db } from '../src/db.ts';
import { sha256 } from '../src/lib/crypto.ts';
import { currentTenantId, withTenant } from '../src/lib/tenant-context.ts';
import { processDueNotifications } from '../src/modules/notifications/worker.ts';
import { createTestAppDb, createTestDb, expectPgError, truncateAll } from './helpers/db.ts';
import { at, bookingData, createTenantFixture, type TenantFixture } from './helpers/fixtures.ts';

const owner = createTestDb();
const app = createTestAppDb();
let a: TenantFixture;
let b: TenantFixture;

/** Tablas con tenantId y cómo contar sus filas SIN filtrar por negocio (el "bug" que RLS debe contener). */
const unfiltered: Record<string, (db: Db) => Promise<number>> = {
  Location: (db) => db.location.count(),
  User: (db) => db.user.count(),
  Session: (db) => db.session.count(),
  Professional: (db) => db.professional.count(),
  Service: (db) => db.service.count(),
  ProfessionalService: (db) => db.professionalService.count(),
  WorkingHour: (db) => db.workingHour.count(),
  TimeBlock: (db) => db.timeBlock.count(),
  Customer: (db) => db.customer.count(),
  Booking: (db) => db.booking.count(),
  AuditLog: (db) => db.auditLog.count(),
  NotificationOutbox: (db) => db.notificationOutbox.count(),
  IdempotencyKey: (db) => db.idempotencyKey.count(),
};

async function seedTenant(slug: string): Promise<TenantFixture> {
  const f = await createTenantFixture(owner, slug);
  const user = await owner.user.create({ data: { tenantId: f.tenantId, email: `admin@${slug}.test`, passwordHash: 'x', role: 'ADMIN' } });
  await owner.session.create({ data: { userId: user.id, tokenHash: sha256(`token-${slug}`), expiresAt: at('2030-01-01T00:00:00Z') } });
  await owner.workingHour.create({ data: { tenantId: f.tenantId, professionalId: f.professionalId, locationId: f.locationId, weekday: 1, startMinute: 540, endMinute: 1080 } });
  await owner.timeBlock.create({ data: { tenantId: f.tenantId, professionalId: f.professionalId, startAt: at('2030-01-01T10:00:00Z'), endAt: at('2030-01-01T11:00:00Z') } });
  const booking = await owner.booking.create({ data: bookingData(f, at('2030-01-02T12:00:00Z')) });
  await owner.auditLog.create({ data: { tenantId: f.tenantId, actorType: 'SYSTEM', action: 'x', entityType: 'Booking', entityId: booking.id } });
  await owner.notificationOutbox.create({
    data: { tenantId: f.tenantId, bookingId: booking.id, channel: 'whatsapp', audience: 'CUSTOMER', template: 't', payload: { to: '+5541998765432', text: slug }, nextAttemptAt: at('2020-01-01T00:00:00Z') },
  });
  await owner.idempotencyKey.create({ data: { tenantId: f.tenantId, key: `k-${slug}`, requestHash: 'h', responseStatus: 201, responseBody: {} } });
  return f;
}

beforeAll(async () => {
  await truncateAll(owner);
  a = await seedTenant('rls-a');
  b = await seedTenant('rls-b');
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe('rol de la aplicación', () => {
  it('está sujeto a RLS (no es superusuario, ni BYPASSRLS, ni propietario); el propietario no', async () => {
    expect(await rlsBypassReason(app)).toBeNull();
    expect(await rlsBypassReason(owner)).toMatch(/propietario|superusuario/);
  });
});

describe('sin negocio fijado (fallo cerrado)', () => {
  it('no ve ninguna fila de ninguna tabla con datos de negocio', async () => {
    expect(currentTenantId()).toBeUndefined();
    for (const [table, count] of Object.entries(unfiltered)) expect(await count(app), table).toBe(0);
  });

  it('no puede escribir filas de ningún negocio', async () => {
    expect(await expectPgError(app.service.create({ data: { tenantId: a.tenantId, name: 'X', durationMinutes: 30, priceCents: 1 } }))).toBe('42501');
    expect((await app.customer.updateMany({ data: { name: 'Hackeado' } })).count).toBe(0);
  });

  it('sí ve los negocios (API pública y login por slug), pero no puede modificarlos', async () => {
    expect(await app.tenant.count()).toBe(2);
    expect((await app.tenant.updateMany({ data: { name: 'Hackeado' } })).count).toBe(0);
  });
});

describe('con el negocio A fijado', () => {
  it('una consulta SIN filtro por tenantId solo devuelve filas de A en todas las tablas', async () => {
    await withTenant(a.tenantId, async () => {
      for (const [table, count] of Object.entries(unfiltered)) expect(await count(app), table).toBe(await countOwner(table, a));
      const customers = await app.customer.findMany();
      expect(customers.map((c) => c.tenantId)).toEqual([a.tenantId]);
    });
  });

  it('no lee, modifica ni borra filas de B aunque se pidan por id', async () => {
    await withTenant(a.tenantId, async () => {
      expect(await app.customer.findUnique({ where: { id: b.customerId } })).toBeNull();
      expect((await app.customer.updateMany({ where: { id: b.customerId }, data: { name: 'Hackeado' } })).count).toBe(0);
      expect((await app.booking.deleteMany({ where: { tenantId: b.tenantId } })).count).toBe(0);
      expect((await app.tenant.updateMany({ where: { id: b.tenantId }, data: { name: 'Hackeado' } })).count).toBe(0);
    });
    expect((await owner.customer.findUniqueOrThrow({ where: { id: b.customerId } })).name).toBe('João');
    expect(await owner.booking.count({ where: { tenantId: b.tenantId } })).toBe(1);
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: b.tenantId } })).name).toBe('rls-b');
  });

  it('no puede crear filas a nombre de B ni mover filas de A a B', async () => {
    await withTenant(a.tenantId, async () => {
      expect(await expectPgError(app.customer.create({ data: { tenantId: b.tenantId, name: 'X', phoneE164: '+5541911112222' } }))).toBe('42501');
      expect(await expectPgError(app.auditLog.create({ data: { tenantId: b.tenantId, actorType: 'SYSTEM', action: 'x', entityType: 'x' } }))).toBe('42501');
      expect(await expectPgError(app.customer.update({ where: { id: a.customerId }, data: { tenantId: b.tenantId } }))).toBeDefined();
    });
  });

  it('dentro de $transaction también se aplica, incluidas las consultas SQL crudas', async () => {
    await withTenant(a.tenantId, () =>
      app.$transaction(async (tx) => {
        expect(await tx.customer.count()).toBe(1);
        const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Booking"`;
        expect(Number(rows[0]!.n)).toBe(1);
        // Una consulta con el cliente normal dentro de la transacción usa su propio negocio fijado.
        expect(await app.booking.count()).toBe(1);
      }),
    );
  });

  it('las transacciones por lotes se rechazan (no fijarían el negocio)', () => {
    expect(() => app.$transaction([app.customer.count()])).toThrow(/async \(tx\)/);
  });
});

describe('concurrencia', () => {
  it('consultas simultáneas de A y B (que Prisma agruparía) devuelven cada una lo suyo', async () => {
    const ids = [a, b].map((f) => ({ f, id: f.customerId }));
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => ids[i % 2]!).map(({ f, id }) =>
        withTenant(f.tenantId, async () => ({ f, found: await app.customer.findUnique({ where: { id } }), mine: await app.customer.findMany() })),
      ),
    );
    for (const { f, found, mine } of results) {
      expect(found?.tenantId).toBe(f.tenantId);
      expect(mine.map((c) => c.tenantId)).toEqual([f.tenantId]);
    }
  });

  it('transacciones simultáneas de A y B no se mezclan (el negocio no queda en la conexión)', async () => {
    const run = (f: TenantFixture) =>
      withTenant(f.tenantId, () => app.$transaction(async (tx) => (await tx.customer.findMany()).map((c) => c.tenantId)));
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => run(i % 2 ? b : a)));
    out.forEach((tenants, i) => expect(tenants).toEqual([(i % 2 ? b : a).tenantId]));
    // Y después, sin negocio, la misma conexión del pool no ve nada.
    expect(await app.customer.count()).toBe(0);
  });
});

describe('funciones acotadas que cruzan negocios', () => {
  it('app_session_tenant devuelve solo el negocio del token', async () => {
    const q = (hash: string) => app.$queryRaw<{ t: string | null }[]>`SELECT app_session_tenant(${hash}) AS t`;
    expect((await q(sha256('token-rls-b')))[0]!.t).toBe(b.tenantId);
    expect((await q(sha256('token-inexistente')))[0]!.t).toBeNull();
  });

  it('el worker reclama avisos de todos los negocios y los marca con el negocio de cada uno', async () => {
    const sent: string[] = [];
    const r = await processDueNotifications(app, { name: 'test', send: async (m) => void sent.push(`${m.tenantId}:${m.text}`) }, new Date());
    expect(r.sent).toBe(2);
    expect(sent.sort()).toEqual([`${a.tenantId}:rls-a`, `${b.tenantId}:rls-b`].sort());
    expect(await owner.notificationOutbox.count({ where: { status: 'SENT' } })).toBe(2);
  });

  it('el rol de la app no puede ejecutar SQL de administración ni tocar el historial de migraciones', async () => {
    expect(await expectPgError(app.$executeRaw`ALTER TABLE "Customer" DISABLE ROW LEVEL SECURITY`)).toBe('42501');
    expect(await expectPgError(app.$queryRaw`SELECT * FROM "_prisma_migrations"`)).toBe('42501');
  });
});

async function countOwner(table: string, f: TenantFixture): Promise<number> {
  if (table === 'Session') return owner.session.count({ where: { user: { tenantId: f.tenantId } } });
  const delegate = (owner as unknown as Record<string, { count: (a: object) => Promise<number> }>)[table[0]!.toLowerCase() + table.slice(1)]!;
  return delegate.count({ where: { tenantId: f.tenantId } });
}
