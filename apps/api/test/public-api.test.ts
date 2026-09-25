import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { createTenantFixture, giveStandardHours, type TenantFixture } from './helpers/fixtures.ts';

// São Paulo. Ahora: miércoles 30/09/2026 09:00 local. Antelación mínima del negocio: 60 min (por defecto).
const db = createTestDb();
const NOW = new Date('2026-09-30T12:00:00Z');
let app: FastifyInstance;
let a: TenantFixture;
let b: TenantFixture;
let andre: string;

beforeEach(async () => {
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  b = await createTenantFixture(db, 'barberia-b');
  andre = (await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'André', sortOrder: 1 } })).id;
  await db.professionalService.create({ data: { tenantId: a.tenantId, professionalId: andre, serviceId: a.serviceId } });
  await giveStandardHours(db, a);
  await giveStandardHours(db, a, andre);
  await giveStandardHours(db, b);
  await db.location.update({ where: { id: a.locationId }, data: { whatsapp: '+5541999990000' } });
  app = await buildTestApp(db, () => NOW);
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.$disconnect();
});

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url: `/api/v1/public${url}`, headers });
let phoneSeq = 0;
const bookingBody = (over: object = {}) => ({
  serviceId: a.serviceId,
  professionalId: a.professionalId,
  date: '2026-10-01',
  time: '10:00',
  customer: { name: 'Pedro', phone: `41 9${String(8_000_000 + phoneSeq++)}` },
  ...over,
});
const post = (body: object, headers: Record<string, string> = {}, slug = 'barberia-a') =>
  app.inject({ method: 'POST', url: `/api/v1/public/${slug}/bookings`, payload: body, headers } as InjectOptions);

describe('negocio, servicios y profesionales', () => {
  it('GET /public/:slug devuelve datos públicos, "hoy" en la zona del negocio y locales activos', async () => {
    await db.location.create({ data: { tenantId: a.tenantId, name: 'Cerrado', active: false } });
    const res = await get('/barberia-a');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: 'barberia-a',
      slug: 'barberia-a',
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
      locale: 'pt-BR',
      slotIntervalMinutes: 15,
      bookingLeadMinutes: 60,
      bookingHorizonDays: 60,
      today: '2026-09-30',
      locations: [{ id: a.locationId, name: 'Principal', address: null, mapsUrl: null, isDefault: true }],
    });
  });

  it('slug inexistente, inválido o negocio suspendido → 404 (también antes de validar el cuerpo)', async () => {
    expect((await get('/no-existe')).statusCode).toBe(404);
    expect((await get('/NO%20VALIDO')).statusCode).toBe(404);
    expect((await post({ basura: true }, {}, 'no-existe')).statusCode).toBe(404);
    await db.tenant.update({ where: { id: a.tenantId }, data: { status: 'SUSPENDED' } });
    expect((await get('/barberia-a')).statusCode).toBe(404);
    expect((await get('/barberia-a/services')).statusCode).toBe(404);
  });

  it('servicios activos con precio del servidor y si se pueden reservar; nunca los de B', async () => {
    await db.service.create({ data: { tenantId: a.tenantId, name: 'Barba', durationMinutes: 20, priceCents: 3000 } });
    await db.service.create({ data: { tenantId: a.tenantId, name: 'Antiguo', durationMinutes: 20, priceCents: 1, active: false } });
    const items = (await get('/barberia-a/services')).json().items;
    expect(items).toEqual([
      expect.objectContaining({ name: 'Barba', priceCents: 3000, currency: 'BRL', bookable: false }),
      expect.objectContaining({ id: a.serviceId, name: 'Corte', durationMinutes: 30, priceCents: 4500, bookable: true }),
    ]);
    expect(items.some((s: { id: string }) => s.id === b.serviceId)).toBe(false);
  });

  it('profesionales activos con sus servicios, filtrables; sin datos internos', async () => {
    await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'Inactivo', active: false } });
    const items = (await get(`/barberia-a/professionals?serviceId=${a.serviceId}`)).json().items;
    expect(items.map((p: { displayName: string }) => p.displayName)).toEqual(['Carlos', 'André']);
    expect(Object.keys(items[0]).sort()).toEqual(['bio', 'displayName', 'id', 'photoUrl', 'serviceIds', 'title']);
    const other = await db.location.create({ data: { tenantId: a.tenantId, name: 'Batel' } });
    expect((await get(`/barberia-a/professionals?locationId=${other.id}`)).json().items).toEqual([]);
    expect((await get(`/barberia-a/professionals?serviceId=${b.serviceId}`)).json().items).toEqual([]);
  });
});

describe('disponibilidad pública', () => {
  it('aplica la antelación mínima y el horizonte del negocio', async () => {
    const today = (await get(`/barberia-a/availability?serviceId=${a.serviceId}&professionalId=any&date=2026-09-30`)).json();
    expect(today.days[0].slots[0].localTime).toBe('10:00'); // ahora 09:00 + 60 min
    await db.tenant.update({ where: { id: a.tenantId }, data: { bookingHorizonDays: 1 } });
    const far = (await get(`/barberia-a/availability?serviceId=${a.serviceId}&professionalId=any&from=2026-10-01&to=2026-10-02`)).json();
    expect(far.days.map((d: { slots: unknown[] }) => d.slots.length > 0)).toEqual([true, false]);
  });

  it('servicio o profesional de otro negocio → 404', async () => {
    expect((await get(`/barberia-a/availability?serviceId=${b.serviceId}&professionalId=any&date=2026-10-01`)).statusCode).toBe(404);
    expect((await get(`/barberia-a/availability?serviceId=${a.serviceId}&professionalId=${b.professionalId}&date=2026-10-01`)).statusCode).toBe(404);
  });
});

describe('POST /public/:slug/bookings', () => {
  it('crea la cita con precio, duración y estado del servidor, origen web y enlace de WhatsApp', async () => {
    await db.tenant.update({ where: { id: a.tenantId }, data: { defaultBookingStatus: 'PENDING' } });
    const res = await post(bookingBody({ notes: 'Degradê' }));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.booking).toMatchObject({
      status: 'PENDING',
      startAt: '2026-10-01T13:00:00.000Z',
      endAt: '2026-10-01T13:30:00.000Z',
      localDate: '2026-10-01',
      localTime: '10:00',
      service: { name: 'Corte', durationMinutes: 30, priceCents: 4500, currency: 'BRL' },
      professional: { id: a.professionalId, displayName: 'Carlos' },
      location: { id: a.locationId, name: 'Principal' },
    });
    expect(body.booking.customer).toBeUndefined();
    expect(body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5541999990000\?text=/);
    expect(decodeURIComponent(body.whatsappUrl)).toContain('Horário: 10:00');
    const saved = await db.booking.findFirstOrThrow();
    expect(saved).toMatchObject({ source: 'PUBLIC_WEB', createdByUserId: null, customerNotes: 'Degradê' });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'booking.created' } });
    expect(log).toMatchObject({ actorType: 'PUBLIC', actorUserId: null });
  });

  it('"sin preferencia" asigna a un profesional del propio negocio', async () => {
    const res = await post(bookingBody({ professionalId: 'any' }));
    expect(res.statusCode).toBe(201);
    expect([a.professionalId, andre]).toContain(res.json().booking.professional.id);
  });

  it('rechaza cualquier dato que decide el servidor', async () => {
    for (const extra of [
      { priceCents: 1 },
      { durationMinutes: 5 },
      { endAt: '2026-10-01T20:00:00Z' },
      { status: 'CONFIRMED' },
      { tenantId: b.tenantId },
      { source: 'ADMIN' },
      { customerId: a.customerId },
    ]) {
      expect((await post(bookingBody(extra))).statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect((await post(bookingBody({ customer: { name: 'X', phone: '123' } }))).statusCode).toBe(400);
    expect(await db.booking.count()).toBe(0);
  });

  it('antelación mínima → 422 TOO_SOON con alternativas; hueco ocupado → 409 con alternativas', async () => {
    const soon = await post(bookingBody({ date: '2026-09-30', time: '09:30' }));
    expect(soon.statusCode).toBe(422);
    expect(soon.json().error.details.reason).toBe('TOO_SOON');
    expect(soon.json().error.details.alternatives[0]).toMatchObject({ localDate: '2026-09-30', localTime: '10:00' });

    expect((await post(bookingBody())).statusCode).toBe(201);
    const taken = await post(bookingBody());
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatchObject({ code: 'SLOT_UNAVAILABLE', details: { reason: 'OVERLAPS_BOOKING' } });
    expect(taken.json().error.details.alternatives.length).toBeGreaterThan(0);
  });

  it('ids de otro negocio → mismo error que inexistentes, nada creado, nunca se asigna a B', async () => {
    expect((await post(bookingBody({ serviceId: b.serviceId }))).json().error.details.reason).toBe('SERVICE_NOT_FOUND');
    expect((await post(bookingBody({ professionalId: b.professionalId }))).json().error.details.reason).toBe('PROFESSIONAL_NOT_FOUND');
    expect((await post(bookingBody({ locationId: b.locationId }))).json().error.details.reason).toBe('NOT_WORKING_THAT_DAY');
    // Reservar en B con los datos de A tampoco funciona.
    expect((await post(bookingBody(), {}, 'barberia-b')).json().error.details.reason).toBe('PROFESSIONAL_NOT_FOUND'); // el profesional se valida primero
    expect(await db.booking.count()).toBe(0);
    expect(await db.customer.count({ where: { tenantId: b.tenantId } })).toBe(1);
  });

  it('un cliente existente no se renombra desde la web', async () => {
    await post(bookingBody({ customer: { name: 'Impostor', phone: '(41) 99876-5432' } }));
    expect((await db.customer.findUniqueOrThrow({ where: { id: a.customerId } })).name).toBe('João');
  });

  it('máximo 3 citas futuras activas por teléfono y negocio', async () => {
    const customer = { name: 'Muitas', phone: '41 97777-1111' };
    for (const time of ['10:00', '11:00', '12:00']) expect((await post(bookingBody({ time, customer }))).statusCode).toBe(201);
    const fourth = await post(bookingBody({ time: '15:00', customer }));
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.code).toBe('BOOKING_LIMIT_REACHED');
    // Con el mismo teléfono en otro negocio no cuenta.
    expect((await post({ ...bookingBody({ time: '15:00', customer }), serviceId: b.serviceId, professionalId: b.professionalId }, {}, 'barberia-b')).statusCode).toBe(201);
  });

  it('rate limit: más de 10 reservas por minuto desde la misma IP → 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await post(bookingBody({ time: '08:00' }))).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 422)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('Idempotency-Key', () => {
  it('un reintento con la misma clave y datos devuelve la misma cita sin crear otra', async () => {
    const body = bookingBody();
    const first = await post(body, { 'idempotency-key': 'reintento-0001' });
    const again = await post(body, { 'idempotency-key': 'reintento-0001' });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json().booking.id).toBe(first.json().booking.id);
    expect(await db.booking.count()).toBe(1);
  });

  it('misma clave con otros datos → 422; clave inválida → 400', async () => {
    await post(bookingBody(), { 'idempotency-key': 'reintento-0002' });
    const reused = await post(bookingBody({ time: '11:00' }), { 'idempotency-key': 'reintento-0002' });
    expect(reused.statusCode).toBe(422);
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await post(bookingBody(), { 'idempotency-key': 'corta' })).statusCode).toBe(400);
  });

  it('tras un error la clave se libera y se puede reintentar', async () => {
    const early = await post(bookingBody({ time: '08:00' }), { 'idempotency-key': 'reintento-0003' });
    expect(early.statusCode).toBe(422);
    expect((await post(bookingBody({ time: '08:00' }), { 'idempotency-key': 'reintento-0003' })).statusCode).toBe(422);
    expect(await db.idempotencyKey.count()).toBe(0);
  });

  it('5 envíos simultáneos con la misma clave → una sola cita', async () => {
    const body = bookingBody();
    const results = await Promise.all(Array.from({ length: 5 }, () => post(body, { 'idempotency-key': 'doble-clic-0001' })));
    expect(await db.booking.count()).toBe(1);
    for (const r of results) expect([201, 409]).toContain(r.statusCode);
    const ids = new Set(results.filter((r) => r.statusCode === 201).map((r) => r.json().booking.id));
    expect(ids.size).toBe(1);
  });

  it('la clave es por negocio: la misma en B no choca', async () => {
    await post(bookingBody(), { 'idempotency-key': 'compartida-01' });
    const inB = await post({ ...bookingBody(), serviceId: b.serviceId, professionalId: b.professionalId }, { 'idempotency-key': 'compartida-01' }, 'barberia-b');
    expect(inB.statusCode).toBe(201);
    expect(await db.booking.count()).toBe(2);
  });
});

describe('CORS', () => {
  it('preflight desde file:// (Origin null) y desde cualquier dominio', async () => {
    for (const origin of ['null', 'https://barbearia-central.com.br']) {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/public/barberia-a/bookings',
        headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,idempotency-key' },
      });
      expect(res.statusCode, origin).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('idempotency-key');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    }
  });

  it('una reserva desde otro dominio funciona (no le aplica la protección CSRF del panel)', async () => {
    const res = await post(bookingBody(), { origin: 'https://barbearia-central.com.br', 'sec-fetch-site': 'cross-site' });
    expect(res.statusCode).toBe(201);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('el panel no expone cabeceras CORS', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { origin: 'https://malicioso.example' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
