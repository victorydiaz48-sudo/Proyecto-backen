// Avisos al negocio por Telegram, contra un servidor de Telegram simulado (Bot API: getMe, getUpdates,
// sendMessage). Conexión del chat con enlace de un solo uso, envío real de los avisos, errores.
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import {
  ChannelTransport,
  handleTelegramUpdate,
  startTelegramLinker,
  TelegramBot,
  TelegramTransport,
  toTelegramHtml,
} from '../src/modules/notifications/telegram.ts';
import type { NotificationTransport, OutgoingMessage } from '../src/modules/notifications/transport.ts';
import { processDueNotifications } from '../src/modules/notifications/worker.ts';
import { buildTestApp, createUser, login } from './helpers/app.ts';
import { createTestAppDb, createTestDb, truncateAll } from './helpers/db.ts';
import { createTenantFixture, giveStandardHours, type TenantFixture } from './helpers/fixtures.ts';

const TOKEN = '123456789:AAFake-token-for-tests_abcdefghijklmnop';

// ---- Telegram simulado ------------------------------------------------------------------------------
interface Sent {
  chat_id: string;
  text: string;
  parse_mode?: string;
}
const tg = {
  server: null as FastifyInstance | null,
  url: '',
  sent: [] as Sent[],
  updates: [] as unknown[],
  failSend: null as null | { status: number; description: string },
  tokens: new Set<string>(),
};

beforeAll(async () => {
  const s = Fastify({ forceCloseConnections: true });
  s.post<{ Params: { token: string; method: string }; Body: Record<string, unknown> }>('/:token/:method', async (req, reply) => {
    tg.tokens.add(req.params.token);
    if (req.params.token !== `bot${TOKEN}`) return reply.status(401).send({ ok: false, description: 'Unauthorized' });
    switch (req.params.method) {
      case 'getMe':
        return { ok: true, result: { id: 1, is_bot: true, username: 'ReservasTestBot' } };
      case 'sendMessage':
        if (tg.failSend) return reply.status(tg.failSend.status).send({ ok: false, description: tg.failSend.description });
        tg.sent.push(req.body as unknown as Sent);
        return { ok: true, result: { message_id: tg.sent.length } };
      case 'getUpdates': {
        const offset = Number(req.body.offset ?? 0);
        const pending = (tg.updates as { update_id: number }[]).filter((u) => u.update_id >= offset);
        if (!pending.length) await new Promise((r) => setTimeout(r, 30));
        return { ok: true, result: pending };
      }
      default:
        return reply.status(404).send({ ok: false, description: 'Not Found' });
    }
  });
  tg.url = await s.listen({ port: 0, host: '127.0.0.1' });
  tg.server = s;
});
afterAll(async () => {
  await tg.server?.close();
});

// ---- Datos -------------------------------------------------------------------------------------------
const owner = createTestDb();
let db: Db;
let now: Date;
let app: FastifyInstance;
let a: TenantFixture;
let adminA: string;
let bot: TelegramBot;

beforeEach(async () => {
  now = new Date('2026-09-30T12:00:00Z');
  tg.sent = [];
  tg.updates = [];
  tg.failSend = null;
  await truncateAll(owner);
  a = await createTenantFixture(owner, 'barberia-a');
  await createTenantFixture(owner, 'barberia-b');
  await giveStandardHours(owner, a);
  await createUser(owner, a.tenantId, 'admin@a.test', 'ADMIN');
  await createUser(owner, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: a.professionalId });
  app = await buildTestApp(owner, () => now, { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_URL: tg.url });
  adminA = (await login(app, 'barberia-a', 'admin@a.test')).cookie;
  db = createTestAppDb(); // el rol de la app (RLS), como el worker en producción
  bot = new TelegramBot(TOKEN, tg.url);
});
afterEach(async () => {
  await app.close();
  await db.$disconnect();
});
afterAll(async () => {
  await owner.$disconnect();
});

const admin = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie = adminA) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers: { cookie } });
const startUpdate = (id: number, text: string, chatId = 777) => ({ update_id: id, message: { chat: { id: chatId, type: 'private' }, text } });
const codeOf = (url: string) => new URL(url).searchParams.get('start')!;
const publicBook = (name = 'Pedro <Admin>') =>
  app.inject({
    method: 'POST',
    url: '/api/v1/public/barberia-a/bookings',
    payload: { serviceId: a.serviceId, professionalId: a.professionalId, date: '2026-10-01', time: '10:00', customer: { name, phone: '41 98888-7777' } },
  });

class Recording implements NotificationTransport {
  readonly name = 'rec';
  sent: OutgoingMessage[] = [];
  async send(m: OutgoingMessage) {
    this.sent.push(m);
  }
}

async function link(): Promise<void> {
  const res = await admin('POST', '/settings/telegram/link');
  await handleTelegramUpdate(db, bot, startUpdate(1, `/start ${codeOf(res.json<{ url: string }>().url)}`), now);
}

describe('conexión del chat del negocio', () => {
  it('sin TELEGRAM_BOT_TOKEN: no disponible y no se genera enlace', async () => {
    const plain = await buildTestApp(owner, () => now);
    const cookie = (await login(plain, 'barberia-a', 'admin@a.test')).cookie;
    const status = await plain.inject({ method: 'GET', url: '/api/v1/admin/settings/telegram', headers: { cookie } });
    expect(status.json()).toEqual({ available: false, linked: false, linkedAt: null });
    const res = await plain.inject({ method: 'POST', url: '/api/v1/admin/settings/telegram/link', headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TELEGRAM_NOT_CONFIGURED');
    await plain.close();
  });

  it('enlace de un solo uso: /start con el código conecta el chat, responde y queda auditado', async () => {
    expect((await admin('GET', '/settings/telegram')).json()).toEqual({ available: true, linked: false, linkedAt: null });
    const res = await admin('POST', '/settings/telegram/link');
    expect(res.statusCode).toBe(200);
    const { url, expiresAt } = res.json<{ url: string; expiresAt: string }>();
    expect(url).toMatch(/^https:\/\/t\.me\/ReservasTestBot\?start=[A-Za-z0-9_-]{43}$/);
    expect(new Date(expiresAt).getTime() - now.getTime()).toBe(30 * 60_000);
    // En la BD solo el hash del código.
    const stored = await owner.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    expect(stored.telegramLinkTokenHash).not.toContain(codeOf(url));

    await handleTelegramUpdate(db, bot, startUpdate(1, `/start ${codeOf(url)}`), now);
    const after = await owner.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    expect(after).toMatchObject({ telegramChatId: '777', telegramLinkTokenHash: null });
    expect(tg.sent.at(-1)).toMatchObject({ chat_id: '777', parse_mode: 'HTML' });
    expect(tg.sent.at(-1)!.text).toContain('<b>barberia-a</b>');
    expect(await owner.auditLog.count({ where: { tenantId: a.tenantId, action: 'tenant.telegram_linked' } })).toBe(1);
    expect((await admin('GET', '/settings/telegram')).json()).toMatchObject({ available: true, linked: true });

    // El mismo código no sirve dos veces (ni para otro chat).
    await handleTelegramUpdate(db, bot, startUpdate(2, `/start ${codeOf(url)}`, 999), now);
    expect(tg.sent.at(-1)).toMatchObject({ chat_id: '999' });
    expect(tg.sent.at(-1)!.text).toMatch(/no es válido o ha caducado/);
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).telegramChatId).toBe('777');
  });

  it('código caducado, inventado o mensaje cualquiera: no conecta nada y no revela ningún negocio', async () => {
    const { url } = (await admin('POST', '/settings/telegram/link')).json<{ url: string }>();
    await handleTelegramUpdate(db, bot, startUpdate(1, `/start ${codeOf(url)}`), new Date(now.getTime() + 31 * 60_000));
    await handleTelegramUpdate(db, bot, startUpdate(2, `/start ${'x'.repeat(43)}`), now);
    await handleTelegramUpdate(db, bot, startUpdate(3, 'hola'), now);
    await handleTelegramUpdate(db, bot, { update_id: 4 }, now); // sin mensaje: se ignora
    expect(tg.sent.map((m) => m.text)).toEqual([
      expect.stringMatching(/caducado/),
      expect.stringMatching(/caducado/),
      expect.stringMatching(/Conectar Telegram/),
    ]);
    expect(tg.sent.every((m) => !m.text.includes('barberia'))).toBe(true);
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).telegramChatId).toBeNull();
  });

  it('un enlace nuevo invalida el anterior; desconectar borra el chat y queda auditado', async () => {
    const first = codeOf((await admin('POST', '/settings/telegram/link')).json<{ url: string }>().url);
    await link();
    await handleTelegramUpdate(db, bot, startUpdate(9, `/start ${first}`, 555), now);
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).telegramChatId).toBe('777');

    expect((await admin('DELETE', '/settings/telegram')).statusCode).toBe(204);
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).telegramChatId).toBeNull();
    expect(await owner.auditLog.count({ where: { tenantId: a.tenantId, action: 'tenant.telegram_unlinked' } })).toBe(1);
  });

  it('solo ADMIN', async () => {
    const pro = (await login(app, 'barberia-a', 'carlos@a.test')).cookie;
    for (const [m, u] of [['GET', '/settings/telegram'], ['POST', '/settings/telegram/link'], ['DELETE', '/settings/telegram']] as const) {
      expect((await admin(m, u, pro)).statusCode).toBe(403);
    }
  });

  it('el bucle de recepción (getUpdates) conecta el chat y se detiene limpio', async () => {
    const { url } = (await admin('POST', '/settings/telegram/link')).json<{ url: string }>();
    tg.updates = [startUpdate(10, 'hola', 1), startUpdate(11, `/start ${codeOf(url)}`, 4242)];
    const warnings: unknown[] = [];
    const stop = startTelegramLinker(db, bot, { warn: (o) => void warnings.push(o) }, { pollSeconds: 0, now: () => now });
    for (let i = 0; i < 100; i++) {
      if ((await owner.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).telegramChatId) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await stop();
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).telegramChatId).toBe('4242');
    expect(warnings).toEqual([]);
  });

  it('si Telegram falla, el bucle avisa en el log (sin el token) y reintenta', async () => {
    const broken = new TelegramBot('999999:wrong-token-for-tests_abcdefghijklmnopq', tg.url);
    const warnings: { err: string }[] = [];
    const stop = startTelegramLinker(db, broken, { warn: (o) => void warnings.push(o as { err: string }) }, { pollSeconds: 0, retryMs: 10 });
    for (let i = 0; i < 100 && warnings.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    await stop();
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings[0]!.err).toMatch(/Telegram getUpdates: 401 Unauthorized/);
    expect(JSON.stringify(warnings)).not.toContain('wrong-token');
  });
});

describe('avisos de reservas por Telegram', () => {
  it('reserva desde la web → aviso al chat conectado, en HTML con el texto escapado', async () => {
    await owner.location.update({ where: { id: a.locationId }, data: { whatsapp: '+5541999990000' } });
    await link();
    tg.sent = [];
    expect((await publicBook()).statusCode).toBe(201);
    const rows = await owner.notificationOutbox.findMany({ where: { audience: 'BUSINESS' }, orderBy: { channel: 'asc' } });
    expect(rows.map((r) => [r.channel, (r.payload as { to: string }).to])).toEqual([
      ['telegram', '777'],
      ['whatsapp', expect.any(String)],
    ]);

    const whatsapp = new Recording();
    const r = await processDueNotifications(db, new ChannelTransport({ telegram: new TelegramTransport(bot) }, whatsapp), now);
    expect(r.failed).toBe(0);
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]).toMatchObject({ chat_id: '777', parse_mode: 'HTML' });
    expect(tg.sent[0]!.text).toContain('<b>barberia-a</b>');
    expect(tg.sent[0]!.text).toContain('Pedro &lt;Admin&gt;');
    expect(tg.sent[0]!.text).not.toContain('<Admin>');
    // Los de WhatsApp (cliente y negocio) siguen por su transporte.
    expect(whatsapp.sent.every((m) => m.channel === 'whatsapp')).toBe(true);
    expect(await owner.notificationOutbox.count({ where: { channel: 'telegram', status: 'SENT' } })).toBe(1);

    // En el panel: el de Telegram sin enlace de WhatsApp.
    const list = (await admin('GET', '/notifications')).json<{ items: { channel: string; waUrl: string | null }[] }>().items;
    expect(list.find((n) => n.channel === 'telegram')!.waUrl).toBeNull();
    expect(list.find((n) => n.channel === 'whatsapp')!.waUrl).toMatch(/^https:\/\/wa\.me\//);
  });

  it('sin chat conectado no hay aviso por Telegram; las citas creadas en el panel tampoco avisan', async () => {
    expect((await publicBook()).statusCode).toBe(201);
    expect(await owner.notificationOutbox.count({ where: { channel: 'telegram' } })).toBe(0);
    await link();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/bookings',
      headers: { cookie: adminA },
      payload: { serviceId: a.serviceId, professionalId: a.professionalId, date: '2026-10-01', time: '15:00', customer: { name: 'Ana', phone: '41 97777-1111' } },
    });
    expect(res.statusCode).toBe(201);
    expect(await owner.notificationOutbox.count({ where: { channel: 'telegram' } })).toBe(0);
  });

  it('si Telegram rechaza el envío, el aviso se reintenta con el error (sin el token)', async () => {
    await link();
    expect((await publicBook()).statusCode).toBe(201);
    tg.failSend = { status: 403, description: 'Forbidden: bot was blocked by the user' };
    const r = await processDueNotifications(db, new ChannelTransport({ telegram: new TelegramTransport(bot) }, new Recording()), now);
    expect(r.retried).toBe(1);
    const row = await owner.notificationOutbox.findFirstOrThrow({ where: { channel: 'telegram' } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(row.lastError).toBe('Telegram sendMessage: 403 Forbidden: bot was blocked by the user');
    expect(row.lastError).not.toContain(TOKEN);
  });
});

describe('formato', () => {
  it('toTelegramHtml: *negrita* → <b>, el resto escapado', () => {
    expect(toTelegramHtml('Nueva cita — *Barbería & Co*\nCliente: <b>x</b> 2*3')).toBe(
      'Nueva cita — <b>Barbería &amp; Co</b>\nCliente: &lt;b&gt;x&lt;/b&gt; 2*3',
    );
  });

  it('TELEGRAM_BOT_TOKEN con formato inválido → la configuración no se acepta', async () => {
    await expect(buildTestApp(owner, () => now, { TELEGRAM_BOT_TOKEN: 'no-es-un-token' })).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });
});
