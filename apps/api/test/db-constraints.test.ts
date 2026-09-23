// Garantías que viven en la BD (migración 20260923231001_db_constraints). Si una migración futura
// las pierde, estos tests fallan.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PgErrorCode } from '../src/db.ts';
import { createTestDb, expectPgError, truncateAll } from './helpers/db.ts';
import { at, bookingData, createTenantFixture, type TenantFixture } from './helpers/fixtures.ts';

const db = createTestDb();
let a: TenantFixture;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
});
afterAll(async () => {
  await db.$disconnect();
});

describe('objetos de BD creados por las migraciones', () => {
  it('existen la extensión btree_gist, el constraint de exclusión y los CHECK/índices propios', async () => {
    const ext = await db.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`;
    expect(ext).toHaveLength(1);

    const constraints = await db.$queryRaw<{ conname: string; contype: string }[]>`
      SELECT conname, contype::text FROM pg_constraint WHERE connamespace = 'public'::regnamespace`;
    const names = new Map(constraints.map((c) => [c.conname, c.contype]));
    expect(names.get('Booking_no_overlap')).toBe('x');
    for (const check of [
      'Booking_time_order_check',
      'Booking_end_covers_duration_check',
      'Tenant_slug_format_check',
      'Tenant_default_status_check',
      'User_email_lowercase_check',
      'Service_duration_check',
      'WorkingHour_range_check',
      'TimeBlock_time_order_check',
      'Customer_phone_e164_check',
    ]) {
      expect(names.get(check), check).toBe('c');
    }

    const idx = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('Location_one_default_per_tenant', 'Service_active_name_per_tenant')`;
    expect(idx).toHaveLength(2);
  });
});

describe('doble reserva (exclusion constraint)', () => {
  it('rechaza una cita que se solapa con otra activa del mismo profesional', async () => {
    await db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z')) });
    const code = await expectPgError(db.booking.create({ data: bookingData(a, at('2026-10-01T13:15:00Z')) }));
    expect(code).toBe(PgErrorCode.EXCLUSION_VIOLATION);
  });

  it('rechaza también la misma hora exacta con estado PENDING', async () => {
    await db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z')) });
    const code = await expectPgError(
      db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z'), { status: 'PENDING' }) }),
    );
    expect(code).toBe(PgErrorCode.EXCLUSION_VIOLATION);
  });

  it('permite citas contiguas: [13:00,13:30) y [13:30,14:00)', async () => {
    await db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z')) });
    await db.booking.create({ data: bookingData(a, at('2026-10-01T13:30:00Z')) });
    expect(await db.booking.count()).toBe(2);
  });

  it('permite la misma hora con otro profesional', async () => {
    const other = await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'André' } });
    await db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z')) });
    await db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z'), { professionalId: other.id }) });
    expect(await db.booking.count()).toBe(2);
  });

  it('una cita cancelada libera el hueco, y no puede reactivarse si alguien lo ocupó', async () => {
    const first = await db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z')) });
    await db.booking.update({ where: { id: first.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    await db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z')) });

    const code = await expectPgError(db.booking.update({ where: { id: first.id }, data: { status: 'CONFIRMED' } }));
    expect(code).toBe(PgErrorCode.EXCLUSION_VIOLATION);
  });

  it('COMPLETED y NO_SHOW no participan en el constraint', async () => {
    await db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z'), { status: 'COMPLETED' }) });
    await db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z'), { status: 'NO_SHOW' }) });
    await db.booking.create({ data: bookingData(a, at('2026-10-01T13:00:00Z')) });
    expect(await db.booking.count()).toBe(3);
  });

  it('con 20 inserciones simultáneas al mismo hueco, solo una tiene éxito', async () => {
    const start = at('2026-10-01T15:00:00Z');
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        // Solapes parciales distintos (desfase de 0 a 19 min) para no probar solo la hora exacta.
        db.booking.create({ data: bookingData(a, new Date(start.getTime() + i * 60_000)) }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect(await db.booking.count()).toBe(1);
  });

  it('exige que endAt cubra la duración guardada', async () => {
    const start = at('2026-10-01T13:00:00Z');
    const code = await expectPgError(
      db.booking.create({ data: bookingData(a, start, { endAt: new Date(start.getTime() + 10 * 60_000) }) }),
    );
    expect(code).toBe(PgErrorCode.CHECK_VIOLATION);
  });
});

describe('CHECKs de validación', () => {
  it('rechaza horarios laborales imposibles', async () => {
    const base = { tenantId: a.tenantId, professionalId: a.professionalId, locationId: a.locationId };
    for (const bad of [
      { weekday: 7, startMinute: 540, endMinute: 600 },
      { weekday: 1, startMinute: 600, endMinute: 600 },
      { weekday: 1, startMinute: 1380, endMinute: 1500 },
    ]) {
      expect(await expectPgError(db.workingHour.create({ data: { ...base, ...bad } }))).toBe(PgErrorCode.CHECK_VIOLATION);
    }
    await db.workingHour.create({ data: { ...base, weekday: 1, startMinute: 1380, endMinute: 1440 } });
  });

  it('rechaza teléfonos que no son E.164, emails con mayúsculas y slugs inválidos', async () => {
    expect(
      await expectPgError(db.customer.create({ data: { tenantId: a.tenantId, name: 'X', phoneE164: '41 99876-5432' } })),
    ).toBe(PgErrorCode.CHECK_VIOLATION);
    expect(
      await expectPgError(
        db.user.create({ data: { tenantId: a.tenantId, email: 'Admin@X.com', passwordHash: 'h', role: 'ADMIN' } }),
      ),
    ).toBe(PgErrorCode.CHECK_VIOLATION);
    expect(
      await expectPgError(
        db.tenant.create({
          data: { slug: 'Mal Slug', name: 'x', timezone: 'UTC', defaultCountryCode: '55', currency: 'BRL', locale: 'pt-BR' },
        }),
      ),
    ).toBe(PgErrorCode.CHECK_VIOLATION);
  });

  it('el estado inicial por defecto del tenant solo puede ser PENDING o CONFIRMED', async () => {
    const code = await expectPgError(
      db.tenant.update({ where: { id: a.tenantId }, data: { defaultBookingStatus: 'COMPLETED' } }),
    );
    expect(code).toBe(PgErrorCode.CHECK_VIOLATION);
    const t = await db.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    expect(t.defaultBookingStatus).toBe('CONFIRMED');
  });

  it('nombre de servicio único entre activos (sin distinguir mayúsculas); los archivados pueden repetirlo', async () => {
    expect(
      await expectPgError(
        db.service.create({ data: { tenantId: a.tenantId, name: 'CORTE', durationMinutes: 30, priceCents: 1 } }),
      ),
    ).toBe(PgErrorCode.UNIQUE_VIOLATION);
    await db.service.update({ where: { id: a.serviceId }, data: { active: false } });
    await db.service.create({ data: { tenantId: a.tenantId, name: 'Corte', durationMinutes: 30, priceCents: 1 } });
  });
});
