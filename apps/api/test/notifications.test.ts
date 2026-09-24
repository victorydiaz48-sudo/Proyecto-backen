import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderTemplate } from '../src/modules/notifications/templates.ts';
import type { NotificationTransport, OutgoingMessage } from '../src/modules/notifications/transport.ts';
import { MAX_ATTEMPTS, processDueNotifications } from '../src/modules/notifications/worker.ts';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { createTenantFixture, giveStandardHours, type TenantFixture } from './helpers/fixtures.ts';

// São Paulo. Ahora: miércoles 30/09/2026 09:00. Cita el jueves 01/10 a las 10:00 (13:00Z).
const db = createTestDb();
let now = new Date('2026-09-30T12:00:00Z');
let app: FastifyInstance;
let a: TenantFixture;
let b: TenantFixture;
let adminA: string;

beforeEach(async () => {
  now = new Date('2026-09-30T12:00:00Z');
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  b = await createTenantFixture(db, 'barberia-b');
  await giveStandardHours(db, a);
  await db.location.update({ where: { id: a.locationId }, data: { whatsapp: '+5541999990000' } });
  await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN');
  app = await buildTestApp(db, () => now);
  adminA = (await login(app, 'barberia-a', 'admin@a.test')).cookie;
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.$disconnect();
});

const publicBook = (over: object = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/public/barberia-a/bookings',
    payload: { serviceId: a.serviceId, professionalId: a.professionalId, date: '2026-10-01', time: '10:00', customer: { name: 'Pedro', phone: '41 98888-7777' }, ...over },
  });
const admin = (method: InjectOptions['method'], url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers: { cookie: adminA }, ...(payload ? { payload } : {}) });
const outbox = () => db.notificationOutbox.findMany({ orderBy: [{ nextAttemptAt: 'asc' }, { template: 'asc' }] });
const summary = async () => (await outbox()).map((n) => [n.audience, n.template, n.status]);

class RecordingTransport implements NotificationTransport {
  readonly name = 'test';
  sent: OutgoingMessage[] = [];
  failWith: string | null = null;
  delayMs = 0;
  async send(m: OutgoingMessage) {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failWith) throw new Error(this.failWith);
    this.sent.push(m);
  }
}

describe('avisos encolados al reservar', () => {
  it('reserva web: confirmación al cliente, aviso al negocio y recordatorio 24 h antes', async () => {
    expect((await publicBook()).statusCode).toBe(201);
    const rows = await outbox();
    expect(rows.map((n) => [n.audience, n.template, n.nextAttemptAt.toISOString()])).toEqual([
      ['BUSINESS', 'business.booking_created', now.toISOString()],
      ['CUSTOMER', 'customer.booking_created', now.toISOString()],
      ['CUSTOMER', 'customer.booking_reminder', '2026-09-30T13:00:00.000Z'],
    ]);
    const toBusiness = rows[0]!.payload as { to: string; text: string };
    expect(toBusiness.to).toBe('+5541999990000');
    expect(toBusiness.text).toContain('Cliente: Pedro (+5541988887777)');
    expect((rows[1]!.payload as { to: string }).to).toBe('+5541988887777');
    expect((rows[1]!.payload as { text: string }).text).toContain('01/10/2026 às 10:00');
  });

  it('cita creada en el panel: avisa al cliente, no al propio negocio', async () => {
    await admin('POST', '/bookings', { serviceId: a.serviceId, professionalId: a.professionalId, date: '2026-10-01', time: '10:00', customer: { name: 'Pedro', phone: '41 98888-7777' } });
    expect(await summary()).toEqual([
      ['CUSTOMER', 'customer.booking_created', 'PENDING'],
      ['CUSTOMER', 'customer.booking_reminder', 'PENDING'],
    ]);
  });

  it('si el local de la cita no tiene WhatsApp, usa el del local por defecto', async () => {
    const batel = await db.location.create({ data: { tenantId: a.tenantId, name: 'Batel' } });
    await db.workingHour.updateMany({ where: { tenantId: a.tenantId }, data: { locationId: batel.id } });
    const res = await publicBook();
    expect(res.json().booking.location.name).toBe('Batel');
    const toBusiness = (await outbox()).find((n) => n.audience === 'BUSINESS')!;
    expect((toBusiness.payload as { to: string }).to).toBe('+5541999990000');
  });

  it('sin ningún WhatsApp del negocio no hay aviso al negocio (el del cliente sí)', async () => {
    await db.location.update({ where: { id: a.locationId }, data: { whatsapp: null } });
    await publicBook();
    const rows = await summary();
    expect(rows.some(([aud]) => aud === 'BUSINESS')).toBe(false);
    expect(rows.some(([aud]) => aud === 'CUSTOMER')).toBe(true);
  });

  it('estado PENDING: "recibida" sin recordatorio; al confirmar, "confirmada" + recordatorio', async () => {
    await db.tenant.update({ where: { id: a.tenantId }, data: { defaultBookingStatus: 'PENDING' } });
    const booking = (await publicBook()).json().booking;
    expect(await summary()).toEqual([
      ['BUSINESS', 'business.booking_created', 'PENDING'],
      ['CUSTOMER', 'customer.booking_received', 'PENDING'],
    ]);
    await admin('POST', `/bookings/${booking.id}/status`, { status: 'CONFIRMED' });
    const templates = (await summary()).map(([, t]) => t);
    expect(templates).toContain('customer.booking_confirmed');
    expect(templates).toContain('customer.booking_reminder');
  });

  it('cancelar anula el recordatorio pendiente y avisa al cliente', async () => {
    const booking = (await publicBook()).json().booking;
    await admin('POST', `/bookings/${booking.id}/status`, { status: 'CANCELLED' });
    const rows = await summary();
    expect(rows).toContainEqual(['CUSTOMER', 'customer.booking_reminder', 'CANCELLED']);
    expect(rows).toContainEqual(['CUSTOMER', 'customer.booking_cancelled', 'PENDING']);
    expect(rows.filter(([, , s]) => s === 'PENDING').map(([, t]) => t)).toEqual(['customer.booking_cancelled']);
  });

  it('mover la cita anula lo pendiente y programa el recordatorio con la nueva hora', async () => {
    const booking = (await publicBook()).json().booking;
    await admin('PATCH', `/bookings/${booking.id}`, { date: '2026-10-02', time: '15:00' });
    const pending = (await outbox()).filter((n) => n.status === 'PENDING');
    expect(pending.map((n) => n.template).sort()).toEqual(['customer.booking_reminder', 'customer.booking_rescheduled']);
    const reminder = pending.find((n) => n.template === 'customer.booking_reminder')!;
    expect(reminder.nextAttemptAt.toISOString()).toBe('2026-10-01T18:00:00.000Z'); // 02/10 15:00 local − 24 h
    expect((pending.find((n) => n.template === 'customer.booking_rescheduled')!.payload as { text: string }).text).toContain('02/10/2026 às 15:00');
  });

  it('sin recordatorio si faltan menos de 24 h', async () => {
    await publicBook({ date: '2026-09-30', time: '15:00' });
    expect((await summary()).map(([, t]) => t)).not.toContain('customer.booking_reminder');
  });

  it('si la reserva falla (hueco ocupado) no queda ningún aviso: misma transacción', async () => {
    await publicBook();
    const before = (await outbox()).length;
    expect((await publicBook({ customer: { name: 'Ana', phone: '41 3000-0001' } })).statusCode).toBe(409);
    expect((await outbox()).length).toBe(before);
  });

  it('idioma del negocio: español', async () => {
    await db.tenant.update({ where: { id: a.tenantId }, data: { locale: 'es-ES' } });
    await publicBook();
    const text = ((await outbox()).find((n) => n.template === 'customer.booking_created')!.payload as { text: string }).text;
    expect(text).toContain('¡Hola, Pedro! Tu cita en *barberia-a* está confirmada para el 01/10/2026 a las 10:00.');
  });
});

describe('worker de envío', () => {
  it('envía solo lo vencido (el recordatorio espera a su hora) y lo marca como enviado', async () => {
    await publicBook();
    const t = new RecordingTransport();
    expect(await processDueNotifications(db, t, now)).toEqual({ sent: 2, failed: 0, retried: 0 });
    expect(t.sent.map((m) => m.to).sort()).toEqual(['+5541988887777', '+5541999990000']);
    expect((await summary()).map(([, tpl, s]) => `${tpl}:${s}`)).toEqual([
      'business.booking_created:SENT',
      'customer.booking_created:SENT',
      'customer.booking_reminder:PENDING',
    ]);
    expect(await processDueNotifications(db, t, now)).toEqual({ sent: 0, failed: 0, retried: 0 });
    expect((await processDueNotifications(db, t, new Date('2026-09-30T13:00:00Z'))).sent).toBe(1);
  });

  it('si el transporte falla, reintenta con espera creciente y tras 5 intentos lo marca FAILED; la cita sigue intacta', async () => {
    await admin('POST', '/bookings', { serviceId: a.serviceId, professionalId: a.professionalId, date: '2026-09-30', time: '15:00', customer: { name: 'Pedro', phone: '41 98888-7777' } });
    const t = new RecordingTransport();
    t.failWith = 'proveedor caído';
    let clock = now;
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect((await processDueNotifications(db, t, clock)).retried, `intento ${i}`).toBe(1);
      const row = (await outbox())[0]!;
      expect(row).toMatchObject({ status: 'PENDING', attempts: i, lastError: 'proveedor caído' });
      expect(row.nextAttemptAt > clock).toBe(true);
      clock = new Date(row.nextAttemptAt.getTime());
    }
    expect((await processDueNotifications(db, t, clock)).failed).toBe(1);
    expect((await outbox())[0]).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS });
    expect(await db.booking.count({ where: { status: 'CONFIRMED' } })).toBe(1);
  });

  it('dos workers a la vez nunca envían el mismo aviso', async () => {
    for (let i = 0; i < 6; i++) {
      await publicBook({ time: ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30'][i], customer: { name: `C${i}`, phone: `41 3000-000${i}` } });
    }
    const t = new RecordingTransport();
    t.delayMs = 20;
    await Promise.all([processDueNotifications(db, t, now, 50), processDueNotifications(db, t, now, 50)]);
    const ids = t.sent.map((m) => m.id);
    expect(ids).toHaveLength(12); // 6 al cliente + 6 al negocio
    expect(new Set(ids).size).toBe(12);
  });
});

describe('GET /admin/notifications', () => {
  it('lista los avisos del negocio con su enlace wa.me; nunca los de B; solo ADMIN', async () => {
    await publicBook();
    await db.notificationOutbox.create({
      data: { tenantId: b.tenantId, channel: 'whatsapp', audience: 'CUSTOMER', template: 'customer.booking_created', payload: { to: '+34600000000', text: 'de B' } },
    });
    const res = await admin('GET', '/notifications');
    const items = res.json().items as { to: string; waUrl: string; audience: string; status: string }[];
    expect(items).toHaveLength(3);
    expect(items.some((n) => n.to === '+34600000000')).toBe(false);
    expect(items.find((n) => n.audience === 'BUSINESS')!.waUrl).toMatch(/^https:\/\/wa\.me\/5541999990000\?text=/);
    expect((await admin('GET', '/notifications?status=SENT')).json().items).toEqual([]);

    await createUser(db, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: a.professionalId });
    const pro = (await login(app, 'barberia-a', 'carlos@a.test')).cookie;
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/notifications', headers: { cookie: pro } })).statusCode).toBe(403);
  });
});

describe('plantillas', () => {
  it('portugués por defecto y español para locales es-*', () => {
    const data = { businessName: 'Central', customerName: 'Ana', customerPhone: '+1', serviceName: 'Corte', professionalName: 'Carlos', locationName: 'Centro', localDate: '2026-10-01', localTime: '10:00' };
    expect(renderTemplate('customer.booking_reminder', 'pt-BR', data)).toMatch(/^Lembrete: amanhã, 01\/10\/2026 às 10:00/);
    expect(renderTemplate('customer.booking_reminder', 'es-AR', data)).toMatch(/^Recordatorio: mañana, 01\/10\/2026 a las 10:00/);
    expect(renderTemplate('customer.booking_cancelled', 'es-ES', data)).not.toContain('Servicio');
  });
});

describe('bucle del worker y transporte "log"', () => {
  it('el bucle procesa los avisos solo, sin intervención, y se puede detener', async () => {
    const { startNotificationWorker } = await import('../src/modules/notifications/worker.ts');
    now = new Date();
    await publicBookFuture();
    const t = new RecordingTransport();
    const errors: unknown[] = [];
    const stop = startNotificationWorker(db, t, { error: (e) => errors.push(e) }, 50);
    for (let i = 0; i < 40 && t.sent.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(t.sent).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it('LogTransport registra el aviso sin el texto y con el teléfono enmascarado', async () => {
    const { LogTransport } = await import('../src/modules/notifications/transport.ts');
    const logged: unknown[] = [];
    await new LogTransport({ info: (obj: unknown) => logged.push(obj) } as never).send({ id: 'n1', tenantId: 't1', channel: 'whatsapp', to: '+5541988887777', text: 'Olá Pedro, dados privados' });
    expect(JSON.stringify(logged)).not.toContain('Pedro');
    expect(JSON.stringify(logged)).not.toContain('988887777');
    expect(logged[0]).toMatchObject({ notificationId: 'n1', to: '+554…77', length: 25 });
  });
});

/** Reserva pública a unos días vista respecto del reloj real (para el bucle del worker). */
async function publicBookFuture() {
  const d = new Date(Date.now() + 3 * 86_400_000);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  const realApp = await buildTestApp(db);
  const res = await realApp.inject({
    method: 'POST',
    url: '/api/v1/public/barberia-a/bookings',
    payload: { serviceId: a.serviceId, professionalId: a.professionalId, date: d.toISOString().slice(0, 10), time: '10:00', customer: { name: 'Pedro', phone: '41 98888-7777' } },
  });
  await realApp.close();
  expect(res.statusCode).toBe(201);
}
