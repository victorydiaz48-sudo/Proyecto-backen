// Fase 8: "sin preferencia" y protección contra doble reserva bajo concurrencia.
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { bookingData, createTenantFixture, giveStandardHours, type TenantFixture } from './helpers/fixtures.ts';

// São Paulo. Ahora: miércoles 30/09/2026 09:00. Carlos (sortOrder 0), André (1), Bia (2); todos hacen "Corte".
const db = createTestDb();
const NOW = new Date('2026-09-30T12:00:00Z');
let app: FastifyInstance;
let a: TenantFixture;
let carlos: string;
let andre: string;
let bia: string;
let adminA: string;
let proA: string;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  carlos = a.professionalId;
  andre = (await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'André', sortOrder: 1 } })).id;
  bia = (await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'Bia', sortOrder: 2 } })).id;
  for (const id of [andre, bia]) {
    await db.professionalService.create({ data: { tenantId: a.tenantId, professionalId: id, serviceId: a.serviceId } });
  }
  for (const id of [carlos, andre, bia]) await giveStandardHours(db, a, id);
  await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN');
  await createUser(db, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: carlos });
  app = await buildTestApp(db, () => NOW);
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
let phoneSeq = 0;
const book = (over: object = {}, cookie = adminA) =>
  call(cookie, 'POST', '/bookings', {
    serviceId: a.serviceId,
    professionalId: 'any',
    date: '2026-10-01',
    time: '10:00',
    customer: { name: 'Cliente', phone: `41 3${String(100_000 + phoneSeq++).padStart(7, '0')}` },
    ...over,
  });
/** Cita directa en BD para Carlos/André/Bia el jueves 01/10 a la hora local indicada. */
const seedBooking = (professionalId: string, hhmmUtc: string) =>
  db.booking.create({ data: bookingData({ ...a, professionalId }, new Date(`2026-10-01T${hhmmUtc}:00Z`)) });
const assigned = (res: LightMyRequestResponse): string => res.json().professional.id;

describe('asignación "sin preferencia"', () => {
  it('asigna al profesional libre con menos citas ese día', async () => {
    await seedBooking(carlos, '18:00');
    await seedBooking(andre, '19:00');
    await seedBooking(andre, '20:00');
    const res = await book();
    expect(res.statusCode).toBe(201);
    expect(assigned(res)).toBe(bia);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'booking.created' } });
    expect(log.after).toMatchObject({ professionalId: bia, assignedFromAny: true });
  });

  it('a igualdad de citas, respeta el orden del negocio', async () => {
    expect(assigned(await book())).toBe(carlos);
    expect(assigned(await book({ time: '11:00' }))).toBe(andre);
    expect(assigned(await book({ time: '12:00' }))).toBe(bia);
    expect(assigned(await book({ time: '15:00' }))).toBe(carlos);
  });

  it('salta al que tiene menos citas si no está libre en esa franja (cita o bloqueo)', async () => {
    await db.timeBlock.create({ data: { tenantId: a.tenantId, professionalId: carlos, startAt: new Date('2026-10-01T12:00:00Z'), endAt: new Date('2026-10-01T16:00:00Z') } });
    await seedBooking(andre, '13:00'); // 10:00 local
    await seedBooking(bia, '17:00');
    await seedBooking(bia, '18:00');
    expect(assigned(await book())).toBe(bia);
  });

  it('solo considera profesionales activos que hacen el servicio y trabajan en el local pedido', async () => {
    await db.professional.update({ where: { id: carlos }, data: { active: false } });
    await db.professionalService.delete({ where: { professionalId_serviceId: { professionalId: andre, serviceId: a.serviceId } } });
    expect(assigned(await book())).toBe(bia);
    const other = await db.location.create({ data: { tenantId: a.tenantId, name: 'Batel' } });
    const res = await book({ time: '11:00', locationId: other.id });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.reason).toBe('NOT_WORKING_THAT_DAY');
  });

  it('si todos están ocupados → el mismo 409 SLOT_UNAVAILABLE con alternativas "sin preferencia"', async () => {
    for (const id of [carlos, andre, bia]) await seedBooking(id, '13:00');
    const res = await book();
    expect(res.statusCode).toBe(409);
    const { error } = res.json();
    expect(error).toMatchObject({ code: 'SLOT_UNAVAILABLE', details: { reason: 'OVERLAPS_BOOKING' } });
    expect(error.details.alternatives[0]).toMatchObject({ localDate: '2026-10-01' });
    expect(error.details.alternatives[0].professionalIds.sort()).toEqual([andre, bia, carlos].sort());
  });

  it('si ninguno puede por reglas → 422 SLOT_INVALID con el motivo y alternativas', async () => {
    const res = await book({ time: '08:00' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details).toMatchObject({ reason: 'OUTSIDE_WORKING_HOURS' });
    expect(res.json().error.details.alternatives[0].localTime).toBe('09:00');
  });

  it('servicio sin profesionales o inexistente', async () => {
    const barba = await db.service.create({ data: { tenantId: a.tenantId, name: 'Barba', durationMinutes: 20, priceCents: 3000 } });
    expect((await book({ serviceId: barba.id })).json().error.details).toEqual({ reason: 'PROFESSIONAL_DOES_NOT_OFFER_SERVICE' });
    expect((await book({ serviceId: '00000000-0000-4000-8000-000000000000' })).json().error.details).toEqual({ reason: 'SERVICE_NOT_FOUND' });
  });

  it('un PROFESSIONAL no puede usar "sin preferencia" (solo su agenda)', async () => {
    expect((await book({}, proA)).statusCode).toBe(403);
  });
});

describe('concurrencia', () => {
  it('8 reservas "sin preferencia" simultáneas con 3 profesionales libres → 3 citas, una por profesional, y 5 × 409', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => book()));
    const ok = results.filter((r) => r.statusCode === 201);
    expect(ok.map(assigned).sort()).toEqual([andre, bia, carlos].sort());
    const rejected = results.filter((r) => r.statusCode !== 201);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) {
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toMatchObject({ code: 'SLOT_UNAVAILABLE', details: { reason: 'OVERLAPS_BOOKING' } });
      expect(Array.isArray(r.json().error.details.alternatives)).toBe(true);
    }
    expect(await db.booking.count()).toBe(3);
  });

  it('mezcla de reservas concretas y "sin preferencia" al mismo tiempo nunca duplica a nadie', async () => {
    for (let round = 0; round < 3; round++) {
      const time = ['10:00', '11:00', '15:00'][round]!;
      const results = await Promise.all([
        ...Array.from({ length: 4 }, () => book({ time, professionalId: carlos })),
        ...Array.from({ length: 4 }, () => book({ time, professionalId: andre })),
        ...Array.from({ length: 6 }, () => book({ time })),
      ]);
      expect(results.every((r) => r.statusCode === 201 || r.statusCode === 409), `ronda ${round}`).toBe(true);
      const winners = results.filter((r) => r.statusCode === 201).map(assigned);
      expect(winners.sort(), `ronda ${round}`).toEqual([andre, bia, carlos].sort());
    }
    // Ningún profesional con dos citas activas solapadas (comprobación directa en la BD).
    const overlapsInDb = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Booking" x JOIN "Booking" y
        ON x."professionalId" = y."professionalId" AND x.id < y.id
       AND tstzrange(x."startAt", x."endAt", '[)') && tstzrange(y."startAt", y."endAt", '[)')
     WHERE x.status IN ('PENDING','CONFIRMED') AND y.status IN ('PENDING','CONFIRMED')`;
    expect(Number(overlapsInDb[0]!.n)).toBe(0);
  });

  it('solapes parciales simultáneos (10:00, 10:10, 10:20) al mismo profesional → solo una', async () => {
    const results = await Promise.all(
      ['10:00', '10:10', '10:20', '10:00', '10:10', '10:20'].map((time) => book({ time, professionalId: carlos })),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(5);
  });

  it('un cliente nuevo que reserva varias horas a la vez se crea una sola vez', async () => {
    const customer = { name: 'Nuevo', phone: '41 97777-0000' };
    const results = await Promise.all(['10:00', '10:30', '11:00', '11:30', '12:00'].map((time) => book({ time, professionalId: carlos, customer })));
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(await db.customer.count({ where: { phoneE164: '+5541977770000' } })).toBe(1);
  });

  it('crear un bloqueo y una cita a la vez para el mismo profesional: nunca quedan ambos solapados', async () => {
    for (let round = 0; round < 5; round++) {
      await db.booking.deleteMany();
      await db.timeBlock.deleteMany();
      const [blockRes, bookingRes] = await Promise.all([
        call(adminA, 'POST', '/time-blocks', { professionalId: carlos, startAt: '2026-10-01T10:00:00-03:00', endAt: '2026-10-01T11:00:00-03:00' }),
        book({ professionalId: carlos }),
      ]);
      const created = [blockRes.statusCode, bookingRes.statusCode].filter((c) => c === 201);
      expect(created, `ronda ${round}`).toHaveLength(1);
    }
  });
});
