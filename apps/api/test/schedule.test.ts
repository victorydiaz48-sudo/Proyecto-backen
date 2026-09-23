import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { bookingData, createTenantFixture, type TenantFixture } from './helpers/fixtures.ts';

// Tenant en America/Sao_Paulo (UTC-3). 2026-10-01 es jueves (weekday 4).
const db = createTestDb();
const NOW = new Date('2026-09-30T12:00:00Z');
let app: FastifyInstance;
let a: TenantFixture;
let b: TenantFixture;
let otherProA: string;
let adminA: string;
let proA: string;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  b = await createTenantFixture(db, 'barberia-b');
  otherProA = (await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'André' } })).id;
  await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN');
  await createUser(db, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: a.professionalId });
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
const putHours = (cookie: string, professionalId: string, intervals: object[]) =>
  call(cookie, 'PUT', `/professionals/${professionalId}/working-hours`, { intervals });
const iv = (weekday: number, start: string, end: string, locationId = a.locationId) => ({ locationId, weekday, start, end });

describe('horario laboral', () => {
  it('guarda varios intervalos por día y los devuelve ordenados en HH:MM', async () => {
    const res = await putHours(adminA, a.professionalId, [iv(4, '14:00', '19:00'), iv(4, '09:00', '13:00'), iv(6, '09:00', '15:00')]);
    expect(res.statusCode).toBe(200);
    const get = (await call(adminA, 'GET', `/professionals/${a.professionalId}/working-hours`)).json().items;
    expect(get.map((x: { weekday: number; start: string; end: string }) => [x.weekday, x.start, x.end])).toEqual([
      [4, '09:00', '13:00'],
      [4, '14:00', '19:00'],
      [6, '09:00', '15:00'],
    ]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'professional.working_hours_updated' } });
    expect(log.after).toMatchObject({ intervals: [{ weekday: 4, start: '09:00' }, { weekday: 4, start: '14:00' }, { weekday: 6 }] });
  });

  it('acepta intervalos contiguos y hasta 24:00 (horario que cruza medianoche en dos filas)', async () => {
    const res = await putHours(adminA, a.professionalId, [iv(5, '18:00', '24:00'), iv(6, '00:00', '02:00'), iv(4, '09:00', '13:00'), iv(4, '13:00', '15:00')]);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(4);
  });

  it('rechaza solapes el mismo día aunque sean en locales distintos', async () => {
    const other = await db.location.create({ data: { tenantId: a.tenantId, name: 'Batel' } });
    const res = await putHours(adminA, a.professionalId, [iv(4, '09:00', '13:00'), iv(4, '12:00', '15:00', other.id)]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.fields[0].message).toMatch(/solapa/);
  });

  it('valida formato, orden, día y locales (inexistente, de B o inactivo)', async () => {
    const inactive = await db.location.create({ data: { tenantId: a.tenantId, name: 'Cerrado', active: false } });
    for (const bad of [
      [iv(4, '13:00', '09:00')],
      [iv(4, '09:00', '09:00')],
      [iv(4, '24:00', '24:00')],
      [iv(4, '9:00', '13:00')],
      [iv(7, '09:00', '13:00')],
      [iv(4, '09:00', '13:00', b.locationId)],
      [iv(4, '09:00', '13:00', inactive.id)],
      [{ ...iv(4, '09:00', '13:00'), tenantId: b.tenantId }],
    ]) {
      expect((await putHours(adminA, a.professionalId, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(await db.workingHour.count()).toBe(0);
  });

  it('no deja citas futuras fuera de horario; ignora pasadas y canceladas', async () => {
    await putHours(adminA, a.professionalId, [iv(4, '09:00', '19:00')]);
    // Jueves 1/10 10:00–10:30 local = 13:00Z.
    await db.booking.create({ data: bookingData(a, new Date('2026-10-01T13:00:00Z')) });
    await db.booking.create({ data: bookingData(a, new Date('2026-09-24T13:00:00Z')) }); // pasada
    await db.booking.create({ data: bookingData(a, new Date('2026-10-01T21:00:00Z'), { status: 'CANCELLED' }) });

    const cut = await putHours(adminA, a.professionalId, [iv(4, '11:00', '19:00')]);
    expect(cut.statusCode).toBe(409);
    expect(cut.json().error.details).toEqual({ bookingsOutsideHours: 1 });
    const other = await db.location.create({ data: { tenantId: a.tenantId, name: 'Batel' } });
    expect((await putHours(adminA, a.professionalId, [iv(4, '09:00', '19:00', other.id)])).statusCode).toBe(409);

    expect((await putHours(adminA, a.professionalId, [iv(4, '10:00', '10:30')])).statusCode).toBe(200);
  });

  it('una cita que cruza medianoche cabe en dos intervalos contiguos', async () => {
    // Viernes 2/10 23:45 local → sábado 00:15 (02:45Z–03:15Z del 3/10).
    await putHours(adminA, a.professionalId, [iv(5, '18:00', '24:00'), iv(6, '00:00', '02:00')]);
    await db.booking.create({ data: bookingData(a, new Date('2026-10-03T02:45:00Z')) });
    expect((await putHours(adminA, a.professionalId, [iv(5, '18:00', '24:00'), iv(6, '00:00', '01:00')])).statusCode).toBe(200);
    expect((await putHours(adminA, a.professionalId, [iv(5, '18:00', '24:00')])).statusCode).toBe(409);
  });

  it('PROFESSIONAL ve su horario, no el de otros, y no lo cambia', async () => {
    expect((await call(proA, 'GET', `/professionals/${a.professionalId}/working-hours`)).statusCode).toBe(200);
    expect((await call(proA, 'GET', `/professionals/${otherProA}/working-hours`)).statusCode).toBe(404);
    expect((await putHours(proA, a.professionalId, [iv(4, '09:00', '13:00')])).statusCode).toBe(403);
  });

  it('A no lee ni cambia el horario de un profesional de B', async () => {
    expect((await call(adminA, 'GET', `/professionals/${b.professionalId}/working-hours`)).statusCode).toBe(404);
    expect((await putHours(adminA, b.professionalId, [iv(4, '09:00', '13:00')])).statusCode).toBe(404);
    expect(await db.workingHour.count({ where: { tenantId: b.tenantId } })).toBe(0);
  });
});

describe('bloqueos', () => {
  const block = (over: object = {}) => ({ startAt: '2026-10-01T14:00:00-03:00', endAt: '2026-10-01T16:00:00-03:00', ...over });

  it('ADMIN bloquea a un profesional, al local o a todo el negocio', async () => {
    const one = await call(adminA, 'POST', '/time-blocks', block({ professionalId: otherProA, reason: 'Médico' }));
    expect(one.statusCode).toBe(201);
    expect(one.json()).toMatchObject({ professionalId: otherProA, locationId: null, startAt: '2026-10-01T17:00:00.000Z', reason: 'Médico' });
    expect((await call(adminA, 'POST', '/time-blocks', block({ locationId: a.locationId }))).statusCode).toBe(201);
    expect((await call(adminA, 'POST', '/time-blocks', block())).statusCode).toBe(201);
    expect(await db.auditLog.count({ where: { action: 'time_block.created' } })).toBe(3);
  });

  it('un PROFESSIONAL solo bloquea su propia agenda', async () => {
    const own = await call(proA, 'POST', '/time-blocks', block());
    expect(own.statusCode).toBe(201);
    expect(own.json().professionalId).toBe(a.professionalId);
    expect((await call(proA, 'POST', '/time-blocks', block({ professionalId: a.professionalId }))).statusCode).toBe(201);
    for (const bad of [{ professionalId: otherProA }, { professionalId: null }, { locationId: a.locationId }]) {
      expect((await call(proA, 'POST', '/time-blocks', block(bad))).statusCode, JSON.stringify(bad)).toBe(403);
    }
  });

  it('rechaza bloqueos que chocan con citas activas (y acepta los contiguos)', async () => {
    // Cita de Carlos 14:30–15:00 local.
    await db.booking.create({ data: bookingData(a, new Date('2026-10-01T17:30:00Z')) });
    const direct = await call(adminA, 'POST', '/time-blocks', block({ professionalId: a.professionalId }));
    expect(direct.statusCode).toBe(409);
    expect(direct.json().error.details).toEqual({ conflictingBookings: 1 });
    expect((await call(adminA, 'POST', '/time-blocks', block())).statusCode).toBe(409);
    expect((await call(adminA, 'POST', '/time-blocks', block({ locationId: a.locationId }))).statusCode).toBe(409);
    expect((await call(adminA, 'POST', '/time-blocks', block({ professionalId: otherProA }))).statusCode).toBe(201);
    const contiguous = block({ professionalId: a.professionalId, startAt: '2026-10-01T15:00:00-03:00' });
    expect((await call(adminA, 'POST', '/time-blocks', contiguous)).statusCode).toBe(201);
  });

  it('valida fechas y referencias (de B → mismo error que inexistente)', async () => {
    for (const bad of [
      block({ endAt: '2026-10-01T14:00:00-03:00' }),
      block({ startAt: '2026-10-01T14:00:00', endAt: '2026-10-01T16:00:00' }),
      block({ endAt: '2027-10-03T14:00:00-03:00' }),
      block({ professionalId: b.professionalId }),
      block({ locationId: b.locationId }),
      block({ tenantId: b.tenantId }),
    ]) {
      expect((await call(adminA, 'POST', '/time-blocks', bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(await db.timeBlock.count()).toBe(0);
  });

  it('listado por rango; un PROFESSIONAL ve los suyos y los generales, no los de otros', async () => {
    await call(adminA, 'POST', '/time-blocks', block({ professionalId: otherProA }));
    await call(adminA, 'POST', '/time-blocks', block({ reason: 'Feriado' }));
    await call(proA, 'POST', '/time-blocks', block({ startAt: '2026-10-02T09:00:00-03:00', endAt: '2026-10-02T10:00:00-03:00' }));
    const range = '?from=2026-10-01T00:00:00-03:00&to=2026-10-03T00:00:00-03:00';
    expect((await call(adminA, 'GET', `/time-blocks${range}`)).json().items).toHaveLength(3);
    expect((await call(adminA, 'GET', '/time-blocks?from=2026-10-02T00:00:00-03:00&to=2026-10-03T00:00:00-03:00')).json().items).toHaveLength(1);
    const mine = (await call(proA, 'GET', `/time-blocks${range}`)).json().items;
    expect(mine.map((x: { professionalId: string | null }) => x.professionalId).sort()).toEqual([a.professionalId, null].sort());
    expect((await call(adminA, 'GET', '/time-blocks?from=2026-10-03T00:00:00Z&to=2026-10-01T00:00:00Z')).statusCode).toBe(400);
  });

  it('borrado: PROFESSIONAL solo los suyos; A nunca los de B', async () => {
    const mine = (await call(proA, 'POST', '/time-blocks', block())).json();
    const general = (await call(adminA, 'POST', '/time-blocks', block({ startAt: '2026-10-05T09:00:00-03:00', endAt: '2026-10-05T10:00:00-03:00' }))).json();
    const blockB = await db.timeBlock.create({
      data: { tenantId: b.tenantId, startAt: new Date('2026-10-01T12:00:00Z'), endAt: new Date('2026-10-01T13:00:00Z') },
    });
    expect((await call(proA, 'DELETE', `/time-blocks/${general.id}`)).statusCode).toBe(404);
    expect((await call(adminA, 'DELETE', `/time-blocks/${blockB.id}`)).statusCode).toBe(404);
    expect((await call(proA, 'DELETE', `/time-blocks/${mine.id}`)).statusCode).toBe(204);
    expect((await call(adminA, 'DELETE', `/time-blocks/${general.id}`)).statusCode).toBe(204);
    expect(await db.timeBlock.findMany({ select: { id: true } })).toEqual([{ id: blockB.id }]);
    expect(await db.auditLog.count({ where: { action: 'time_block.deleted' } })).toBe(2);
  });

  it('A no ve bloqueos de B en su listado', async () => {
    await db.timeBlock.create({ data: { tenantId: b.tenantId, startAt: new Date('2026-10-01T12:00:00Z'), endAt: new Date('2026-10-01T13:00:00Z') } });
    expect((await call(adminA, 'GET', '/time-blocks?from=2026-09-01T00:00:00Z&to=2026-11-01T00:00:00Z')).json().items).toEqual([]);
  });
});
