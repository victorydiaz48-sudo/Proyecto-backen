import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { createTenantFixture, giveStandardHours, type TenantFixture } from './helpers/fixtures.ts';

// São Paulo. Ahora: miércoles 30/09/2026 09:00 local. Servicio de 30 min, intervalo de 15 min (por defecto).
const db = createTestDb();
const NOW = new Date('2026-09-30T12:00:00Z');
let app: FastifyInstance;
let a: TenantFixture;
let b: TenantFixture;
let andre: string;
let adminA: string;
let proA: string;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  b = await createTenantFixture(db, 'barberia-b');
  andre = (await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'André', sortOrder: 1 } })).id;
  await db.professionalService.create({ data: { tenantId: a.tenantId, professionalId: andre, serviceId: a.serviceId } });
  await giveStandardHours(db, a);
  await giveStandardHours(db, a, andre);
  await giveStandardHours(db, b);
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
/** Un valor '' quita el parámetro por defecto. */
const availability = (params: Record<string, string>, cookie = adminA) => {
  const all = { serviceId: a.serviceId, professionalId: a.professionalId, date: '2026-10-01', ...params };
  const qs = new URLSearchParams(Object.entries(all).filter(([, v]) => v !== ''));
  return call(cookie, 'GET', `/availability?${qs.toString()}`);
};
const timesOf = (body: { days: { slots: { localTime: string }[] }[] }, day = 0) => body.days[day]!.slots.map((s) => s.localTime);
const book = (time: string, over: object = {}) =>
  call(adminA, 'POST', '/bookings', {
    serviceId: a.serviceId,
    professionalId: a.professionalId,
    date: '2026-10-01',
    time,
    customer: { name: 'Pedro', phone: '41 98888-7777' },
    ...over,
  });

describe('GET /admin/availability', () => {
  it('calcula los huecos del día desde el horario, con el intervalo del negocio', async () => {
    const res = await availability({});
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ timezone: 'America/Sao_Paulo', serviceId: a.serviceId, durationMinutes: 30 });
    const t = timesOf(body);
    expect(t[0]).toBe('09:00');
    expect(t).toContain('12:30');
    expect(t).not.toContain('12:45');
    expect(t).not.toContain('13:00');
    expect(t.at(-1)).toBe('18:30');
    expect(body.days[0].slots[0]).toMatchObject({ startAt: '2026-10-01T12:00:00.000Z', locationId: a.locationId, professionalIds: [a.professionalId] });

    await db.tenant.update({ where: { id: a.tenantId }, data: { slotIntervalMinutes: 30 } });
    expect(timesOf((await availability({})).json())).toHaveLength(18); // 09:00–12:30 (8) + 14:00–18:30 (10)
  });

  it('refleja citas y bloqueos reales', async () => {
    await book('10:00');
    await db.timeBlock.create({ data: { tenantId: a.tenantId, professionalId: a.professionalId, startAt: new Date('2026-10-01T17:00:00Z'), endAt: new Date('2026-10-01T22:00:00Z') } });
    const t = timesOf((await availability({})).json());
    expect(t).toContain('09:30');
    expect(t).not.toContain('09:45');
    expect(t).not.toContain('10:00');
    expect(t).not.toContain('10:15');
    expect(t).toContain('10:30');
    expect(t.at(-1)).toBe('12:30');
  });

  it('"sin preferencia" une los huecos e indica qué profesionales están libres', async () => {
    await book('10:00');
    const slots = (await availability({ professionalId: 'any' })).json().days[0].slots as { localTime: string; professionalIds: string[] }[];
    const at = (t: string) => slots.find((s) => s.localTime === t)?.professionalIds.sort();
    expect(at('09:00')).toEqual([a.professionalId, andre].sort());
    expect(at('10:00')).toEqual([andre]);
  });

  it('no ofrece el pasado: hoy empieza en la hora actual', async () => {
    const t = timesOf((await availability({ date: '2026-09-30' })).json());
    expect(t[0]).toBe('09:00');
    const later = await buildTestApp(db, () => new Date('2026-09-30T13:05:00Z'));
    const cookie = (await login(later, 'barberia-a', 'admin@a.test')).cookie;
    const res = await later.inject({
      method: 'GET',
      url: `/api/v1/admin/availability?serviceId=${a.serviceId}&professionalId=${a.professionalId}&date=2026-09-30`,
      headers: { cookie },
    });
    expect(timesOf(res.json())[0]).toBe('10:15');
    await later.close();
  });

  it('rango de fechas (máx. 14 días) y validación de parámetros', async () => {
    const body = (await availability({ date: '', from: '2026-10-01', to: '2026-10-04' })).json();
    expect(body.days.map((d: { date: string; slots: unknown[] }) => [d.date, d.slots.length > 0])).toEqual([
      ['2026-10-01', true],
      ['2026-10-02', true],
      ['2026-10-03', true],
      ['2026-10-04', false],
    ]);
    expect((await availability({ date: '', from: '2026-10-01', to: '2026-10-20' })).statusCode).toBe(400);
    expect((await availability({ date: '' })).statusCode).toBe(400);
    expect((await availability({ professionalId: 'todos' })).statusCode).toBe(400);
  });

  it('servicio o profesional inválidos, inactivos o de B → 404', async () => {
    const barba = await db.service.create({ data: { tenantId: a.tenantId, name: 'Barba', durationMinutes: 20, priceCents: 3000 } });
    const cases: Record<string, string>[] = [{ serviceId: b.serviceId }, { professionalId: b.professionalId }, { serviceId: barba.id }];
    for (const params of cases) {
      expect((await availability(params)).statusCode, JSON.stringify(params)).toBe(404);
    }
    await db.professional.update({ where: { id: andre }, data: { active: false } });
    expect((await availability({ professionalId: andre })).statusCode).toBe(404);
    expect((await availability({ professionalId: 'any' })).json().days[0].slots.every((s: { professionalIds: string[] }) => !s.professionalIds.includes(andre))).toBe(true);
  });

  it('un PROFESSIONAL también puede consultarla', async () => {
    expect((await availability({ professionalId: 'any' }, proA)).statusCode).toBe(200);
  });

  it('todo hueco ofrecido se puede reservar', async () => {
    const t = timesOf((await availability({})).json());
    for (const time of [t[0]!, t[5]!, t.at(-1)!]) {
      expect((await book(time)).statusCode, time).toBe(201);
    }
  });
});

describe('alternativas al fallar una reserva', () => {
  it('hueco ocupado → 409 con alternativas reales cercanas, y cada una se puede reservar', async () => {
    await book('10:00');
    const res = await book('10:00', { customer: { name: 'Ana', phone: '41 3000-0001' } });
    expect(res.statusCode).toBe(409);
    const alts = res.json().error.details.alternatives as { localDate: string; localTime: string; professionalIds: string[] }[];
    expect(alts.map((x) => x.localTime)).toEqual(['09:30', '10:30', '09:15', '10:45', '09:00', '11:00']);
    expect(alts.every((x) => x.localDate === '2026-10-01' && x.professionalIds[0] === a.professionalId)).toBe(true);
    expect(await db.booking.count()).toBe(1); // nunca se reserva otra hora automáticamente
    expect((await book(alts[0]!.localTime, { customer: { name: 'Ana', phone: '41 3000-0001' } })).statusCode).toBe(201);
  });

  it('fuera de horario → 422 con alternativas; en domingo se proponen días siguientes', async () => {
    const early = await book('08:00');
    expect(early.statusCode).toBe(422);
    expect(early.json().error.details.alternatives[0].localTime).toBe('09:00');
    const sunday = await book('10:00', { date: '2026-10-04' });
    expect(sunday.json().error.details.reason).toBe('NOT_WORKING_THAT_DAY');
    expect(sunday.json().error.details.alternatives[0]).toMatchObject({ localDate: '2026-10-05', localTime: '09:00' });
  });

  it('si el profesional no hace el servicio no hay alternativas (no tiene sentido proponerlas)', async () => {
    const barba = await db.service.create({ data: { tenantId: a.tenantId, name: 'Barba', durationMinutes: 20, priceCents: 3000 } });
    const res = await book('10:00', { serviceId: barba.id });
    expect(res.json().error.details).toEqual({ reason: 'PROFESSIONAL_DOES_NOT_OFFER_SERVICE' });
  });

  it('al reprogramar a una hora ocupada también se proponen alternativas', async () => {
    const first = (await book('10:00')).json();
    await book('11:00', { customer: { name: 'Ana', phone: '41 3000-0001' } });
    const res = await call(adminA, 'PATCH', `/bookings/${first.id}`, { date: '2026-10-01', time: '11:00' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.alternatives.length).toBeGreaterThan(0);
  });
});
