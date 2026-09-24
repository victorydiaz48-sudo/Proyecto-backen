import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { bookingData, createTenantFixture, giveStandardHours, type TenantFixture } from './helpers/fixtures.ts';

// São Paulo (UTC-3). Ahora: miércoles 30/09/2026 09:00 local. Jueves 01/10 es laborable.
const db = createTestDb();
let now = new Date('2026-09-30T12:00:00Z');
let app: FastifyInstance;
let a: TenantFixture;
let b: TenantFixture;
let andre: string;
let adminA: string;
let proA: string;

beforeEach(async () => {
  now = new Date('2026-09-30T12:00:00Z');
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  b = await createTenantFixture(db, 'barberia-b');
  andre = (await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'André' } })).id;
  await db.professionalService.create({ data: { tenantId: a.tenantId, professionalId: andre, serviceId: a.serviceId } });
  await giveStandardHours(db, a);
  await giveStandardHours(db, a, andre);
  await giveStandardHours(db, b);
  await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN');
  await createUser(db, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: a.professionalId });
  app = await buildTestApp(db, () => now);
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
const newBooking = (over: object = {}) => ({
  serviceId: a.serviceId,
  professionalId: a.professionalId,
  date: '2026-10-01',
  time: '10:00',
  customer: { name: 'Pedro', phone: '41 98888-7777' },
  ...over,
});
const create = (over: object = {}, cookie = adminA) => call(cookie, 'POST', '/bookings', newBooking(over));

describe('crear cita desde el panel', () => {
  it('el servidor calcula precio, duración, fin, local y estado', async () => {
    const res = await create({ notes: 'Degradê' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      status: 'CONFIRMED',
      startAt: '2026-10-01T13:00:00.000Z',
      endAt: '2026-10-01T13:30:00.000Z',
      localDate: '2026-10-01',
      localTime: '10:00',
      priceCents: 4500,
      currency: 'BRL',
      service: { id: a.serviceId, name: 'Corte', durationMinutes: 30 },
      professional: { id: a.professionalId, displayName: 'Carlos' },
      location: { id: a.locationId },
      customer: { name: 'Pedro', phoneE164: '+5541988887777' },
      customerNotes: 'Degradê',
      source: 'ADMIN',
    });
    expect(await db.auditLog.count({ where: { action: 'booking.created' } })).toBe(1);
  });

  it('usa el estado inicial del negocio salvo que se indique otro', async () => {
    await db.tenant.update({ where: { id: a.tenantId }, data: { defaultBookingStatus: 'PENDING' } });
    expect((await create()).json().status).toBe('PENDING');
    expect((await create({ time: '11:00', status: 'CONFIRMED' })).json().status).toBe('CONFIRMED');
  });

  it('nunca acepta precio, duración, fin, tenant, origen o estados finales del cliente', async () => {
    for (const extra of [
      { priceCents: 1 },
      { durationMinutes: 5 },
      { endAt: '2026-10-01T18:00:00Z' },
      { tenantId: b.tenantId },
      { source: 'PUBLIC_WEB' },
      { status: 'COMPLETED' },
    ]) {
      expect((await create(extra)).statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect(await db.booking.count()).toBe(0);
  });

  it('reutiliza el cliente por teléfono sin renombrarlo, o usa customerId', async () => {
    await create({ customer: { name: 'Otro nombre', phone: '+55 (41) 99876-5432' } });
    const c = await db.customer.findUniqueOrThrow({ where: { id: a.customerId } });
    expect(c.name).toBe('João');
    expect(await db.booking.count({ where: { customerId: a.customerId } })).toBe(1);
    expect((await create({ time: '11:00', customer: undefined, customerId: a.customerId })).statusCode).toBe(201);
    expect((await create({ time: '12:00', customerId: a.customerId })).statusCode).toBe(400);
  });

  it('aplica las reglas de la franja con motivo', async () => {
    const cases: [object, number, string][] = [
      [{ time: '08:30' }, 422, 'OUTSIDE_WORKING_HOURS'],
      [{ time: '13:30' }, 422, 'OUTSIDE_WORKING_HOURS'],
      [{ time: '18:45' }, 422, 'EXCEEDS_CLOSING_TIME'],
      [{ date: '2026-10-04' }, 422, 'NOT_WORKING_THAT_DAY'],
      [{ date: '2026-09-30', time: '08:30' }, 422, 'OUTSIDE_WORKING_HOURS'],
      [{ date: '2026-09-29' }, 422, 'IN_THE_PAST'],
    ];
    for (const [over, status, reason] of cases) {
      const res = await create(over);
      expect([res.statusCode, res.json().error.details?.reason], JSON.stringify(over)).toEqual([status, reason]);
    }
    // El panel no aplica la antelación mínima de la web: 30 minutos desde ahora vale.
    expect((await create({ date: '2026-09-30', time: '09:30' })).statusCode).toBe(201);
  });

  it('hueco ocupado o bloqueado → 409 SLOT_UNAVAILABLE; contiguo sí', async () => {
    expect((await create()).statusCode).toBe(201);
    const taken = await create({ time: '10:15', customer: { name: 'Ana', phone: '41 3000-0001' } });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatchObject({ code: 'SLOT_UNAVAILABLE', details: { reason: 'OVERLAPS_BOOKING' } });
    expect((await create({ time: '10:30' })).statusCode).toBe(201);
    await db.timeBlock.create({ data: { tenantId: a.tenantId, startAt: new Date('2026-10-01T17:00:00Z'), endAt: new Date('2026-10-01T18:00:00Z') } });
    expect((await create({ time: '14:15' })).json().error.details.reason).toBe('OVERLAPS_TIME_BLOCK');
  });

  it('profesional que no hace el servicio, servicio inactivo; ids de B = inexistentes', async () => {
    const barba = await db.service.create({ data: { tenantId: a.tenantId, name: 'Barba', durationMinutes: 20, priceCents: 3000 } });
    expect((await create({ serviceId: barba.id })).json().error.details.reason).toBe('PROFESSIONAL_DOES_NOT_OFFER_SERVICE');
    expect((await create({ serviceId: b.serviceId })).json().error.details.reason).toBe('SERVICE_NOT_FOUND');
    expect((await create({ professionalId: b.professionalId })).json().error.details.reason).toBe('PROFESSIONAL_NOT_FOUND');
    expect((await create({ locationId: b.locationId })).json().error.details.reason).toBe('NOT_WORKING_THAT_DAY');
    expect((await create({ customer: undefined, customerId: b.customerId })).statusCode).toBe(400);
    await db.service.update({ where: { id: a.serviceId }, data: { active: false } });
    expect((await create()).json().error.details.reason).toBe('SERVICE_NOT_FOUND');
    expect(await db.booking.count()).toBe(0);
    expect(await db.customer.count({ where: { tenantId: a.tenantId } })).toBe(1);
  });

  it('rechaza una hora que no existe por el cambio de horario (Madrid, 29/03/2026 02:30)', async () => {
    await db.tenant.update({ where: { id: a.tenantId }, data: { timezone: 'Europe/Madrid' } });
    now = new Date('2026-03-01T00:00:00Z');
    await db.workingHour.create({
      data: { tenantId: a.tenantId, professionalId: a.professionalId, locationId: a.locationId, weekday: 0, startMinute: 0, endMinute: 1440 },
    });
    const res = await create({ date: '2026-03-29', time: '02:30' });
    expect([res.statusCode, res.json().error.details.reason]).toEqual([422, 'INVALID_LOCAL_TIME']);
    const ok = await create({ date: '2026-03-29', time: '03:30' });
    expect(ok.json().startAt).toBe('2026-03-29T01:30:00.000Z');
  });

  it('10 creaciones simultáneas del mismo hueco: 1 cita y 9 respuestas 409 (ningún 500)', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => create({ customer: { name: `C${i}`, phone: `41 3000-00${String(i).padStart(2, '0')}` } })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, ...Array(9).fill(409)]);
    expect(await db.booking.count()).toBe(1);
  });

  it('PROFESSIONAL crea citas en su agenda, no en la de otro', async () => {
    const own = await create({}, proA);
    expect(own.statusCode).toBe(201);
    expect(own.json().source).toBe('PROFESSIONAL');
    expect((await create({ professionalId: andre }, proA)).statusCode).toBe(403);
  });
});

describe('agenda', () => {
  beforeEach(async () => {
    await create();
    await create({ professionalId: andre, time: '11:00' });
    await db.booking.create({ data: bookingData({ ...b }, new Date('2026-10-01T13:00:00Z')) });
  });

  it('ADMIN ve todas las de su negocio en el rango; PROFESSIONAL solo las suyas', async () => {
    const range = '?from=2026-10-01T00:00:00-03:00&to=2026-10-02T00:00:00-03:00';
    expect((await call(adminA, 'GET', `/bookings${range}`)).json().items.map((x: { localTime: string }) => x.localTime)).toEqual(['10:00', '11:00']);
    const mine = (await call(proA, 'GET', `/bookings${range}`)).json().items;
    expect(mine.map((x: { professional: { id: string } }) => x.professional.id)).toEqual([a.professionalId]);
    expect((await call(proA, 'GET', `/bookings${range}&professionalId=${andre}`)).json().items).toEqual([]);
    expect((await call(adminA, 'GET', `/bookings${range}&status=CANCELLED,NO_SHOW`)).json().items).toEqual([]);
    expect((await call(adminA, 'GET', '/bookings?from=2026-10-01T00:00:00Z&to=2027-10-01T00:00:00Z')).statusCode).toBe(400);
  });

  it('detalle: PROFESSIONAL no ve la de otro; A no ve la de B', async () => {
    const [carlos, andreBooking] = (await call(adminA, 'GET', '/bookings')).json().items;
    expect((await call(proA, 'GET', `/bookings/${carlos.id}`)).statusCode).toBe(200);
    expect((await call(proA, 'GET', `/bookings/${andreBooking.id}`)).statusCode).toBe(404);
    const bBooking = await db.booking.findFirstOrThrow({ where: { tenantId: b.tenantId } });
    for (const [method, url, payload] of [
      ['GET', `/bookings/${bBooking.id}`],
      ['PATCH', `/bookings/${bBooking.id}`, { date: '2026-10-01', time: '15:00' }],
      ['POST', `/bookings/${bBooking.id}/status`, { status: 'CANCELLED' }],
    ] as const) {
      expect((await call(adminA, method, url, payload)).statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await db.booking.findUniqueOrThrow({ where: { id: bBooking.id } })).status).toBe('CONFIRMED');
  });
});

describe('reprogramar', () => {
  it('mueve la cita conservando el precio pactado; cambiar de servicio toma el precio vigente', async () => {
    const booking = (await create()).json();
    await db.service.update({ where: { id: a.serviceId }, data: { priceCents: 9900 } });
    const moved = await call(adminA, 'PATCH', `/bookings/${booking.id}`, { date: '2026-10-01', time: '10:15' });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ localTime: '10:15', priceCents: 4500 });

    const barba = await db.service.create({ data: { tenantId: a.tenantId, name: 'Barba', durationMinutes: 20, priceCents: 3000 } });
    await db.professionalService.create({ data: { tenantId: a.tenantId, professionalId: andre, serviceId: barba.id } });
    const changed = await call(adminA, 'PATCH', `/bookings/${booking.id}`, { date: '2026-10-01', time: '15:00', professionalId: andre, serviceId: barba.id });
    expect(changed.json()).toMatchObject({ priceCents: 3000, service: { name: 'Barba', durationMinutes: 20 }, professional: { id: andre }, endAt: '2026-10-01T18:20:00.000Z' });
    expect(await db.auditLog.count({ where: { action: 'booking.rescheduled' } })).toBe(2);
  });

  it('no mueve a un hueco ocupado ni citas canceladas; PROFESSIONAL no la pasa a otro', async () => {
    const first = (await create()).json();
    await create({ time: '11:00' });
    expect((await call(adminA, 'PATCH', `/bookings/${first.id}`, { date: '2026-10-01', time: '10:45' })).statusCode).toBe(409);
    expect((await call(proA, 'PATCH', `/bookings/${first.id}`, { date: '2026-10-01', time: '15:00', professionalId: andre })).statusCode).toBe(403);
    await call(adminA, 'POST', `/bookings/${first.id}/status`, { status: 'CANCELLED' });
    expect((await call(adminA, 'PATCH', `/bookings/${first.id}`, { date: '2026-10-01', time: '15:00' })).statusCode).toBe(409);
  });
});

describe('estados', () => {
  it('cancelar guarda motivo y fecha; reactivar solo ADMIN y si el hueco sigue libre', async () => {
    const booking = (await create()).json();
    const cancelled = await call(proA, 'POST', `/bookings/${booking.id}/status`, { status: 'CANCELLED', reason: 'Cliente avisou' });
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED', cancelReason: 'Cliente avisou', cancelledAt: now.toISOString() });

    expect((await call(proA, 'POST', `/bookings/${booking.id}/status`, { status: 'CONFIRMED' })).statusCode).toBe(403);
    const other = await create({ customer: { name: 'Ana', phone: '41 3000-0001' } });
    expect(other.statusCode).toBe(201);
    const reactivate = await call(adminA, 'POST', `/bookings/${booking.id}/status`, { status: 'CONFIRMED' });
    expect(reactivate.statusCode).toBe(409);

    await call(adminA, 'POST', `/bookings/${other.json().id}/status`, { status: 'CANCELLED' });
    const ok = await call(adminA, 'POST', `/bookings/${booking.id}/status`, { status: 'CONFIRMED' });
    expect(ok.json()).toMatchObject({ status: 'CONFIRMED', cancelledAt: null, cancelReason: null });
  });

  it('transiciones inválidas y COMPLETED/NO_SHOW solo después del inicio', async () => {
    await db.tenant.update({ where: { id: a.tenantId }, data: { defaultBookingStatus: 'PENDING' } });
    const booking = (await create()).json();
    const invalid = await call(adminA, 'POST', `/bookings/${booking.id}/status`, { status: 'COMPLETED' });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json().error.details).toEqual({ from: 'PENDING', to: 'COMPLETED' });
    await call(proA, 'POST', `/bookings/${booking.id}/status`, { status: 'CONFIRMED' });
    expect((await call(proA, 'POST', `/bookings/${booking.id}/status`, { status: 'COMPLETED' })).statusCode).toBe(409);

    now = new Date('2026-10-01T13:40:00Z');
    expect((await call(proA, 'POST', `/bookings/${booking.id}/status`, { status: 'NO_SHOW' })).json().status).toBe('NO_SHOW');
    expect((await call(proA, 'POST', `/bookings/${booking.id}/status`, { status: 'COMPLETED' })).statusCode).toBe(403);
    expect((await call(adminA, 'POST', `/bookings/${booking.id}/status`, { status: 'COMPLETED' })).json().status).toBe('COMPLETED');
    const log = await db.auditLog.findMany({ where: { action: 'booking.status_changed' }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => l.after)).toEqual([{ status: 'CONFIRMED' }, { status: 'NO_SHOW' }, { status: 'COMPLETED' }]);
  });
});
