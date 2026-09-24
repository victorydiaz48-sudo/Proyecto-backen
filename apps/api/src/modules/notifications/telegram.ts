import type { Db } from '../../db.ts';
import { newToken, sha256 } from '../../lib/crypto.ts';
import { withTenant } from '../../lib/tenant-context.ts';
import { writeAudit, type Actor } from '../audit/audit.ts';
import type { NotificationTransport, OutgoingMessage } from './transport.ts';

/*
 * Avisos al negocio por Telegram. Un solo bot para toda la plataforma (TELEGRAM_BOT_TOKEN); cada negocio
 * conecta su chat desde el panel con un enlace de un solo uso (t.me/<bot>?start=<código>). El servidor
 * recibe ese /start consultando a Telegram (getUpdates, sondeo largo): no hace falta webhook ni URL pública.
 */

/** Minutos que vale un enlace de conexión. */
export const TELEGRAM_LINK_MINUTES = 30;

interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number; type: string }; text?: string };
}

/** Cliente mínimo de la Bot API. El token va en la URL: nunca se registra ni aparece en los errores. */
export class TelegramBot {
  private username: string | null = null;

  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://api.telegram.org',
  ) {}

  private async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.baseUrl}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!data?.ok) {
      throw new Error(`Telegram ${method}: ${res.status} ${data?.description ?? 'respuesta inválida'}`.slice(0, 300));
    }
    return data.result as T;
  }

  /** Nombre del bot (para los enlaces t.me), pedido una vez a Telegram. */
  async botUsername(): Promise<string> {
    this.username ??= (await this.call<{ username: string }>('getMe', {})).username;
    return this.username;
  }

  async sendMessage(chatId: string, html: string): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  }

  getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>('getUpdates', { offset, timeout: timeoutSeconds, allowed_updates: ['message'] }, signal);
  }
}

/** Bot configurado (TELEGRAM_BOT_TOKEN) o null. */
export function createTelegramBot(config: { TELEGRAM_BOT_TOKEN?: string | undefined; TELEGRAM_API_URL: string }): TelegramBot | null {
  return config.TELEGRAM_BOT_TOKEN ? new TelegramBot(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_API_URL) : null;
}

const escapeHtml = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Texto de las plantillas (estilo WhatsApp, *negrita*) → HTML de Telegram, escapando lo demás. */
export const toTelegramHtml = (text: string): string => escapeHtml(text).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');

/** Entrega los avisos con canal 'telegram' (el destino es el id del chat). */
export class TelegramTransport implements NotificationTransport {
  readonly name = 'telegram';
  constructor(private readonly bot: TelegramBot) {}

  async send(m: OutgoingMessage): Promise<void> {
    await this.bot.sendMessage(m.to, toTelegramHtml(m.text));
  }
}

/** Elige el transporte según el canal del aviso; los canales sin transporte propio van al de respaldo. */
export class ChannelTransport implements NotificationTransport {
  readonly name = 'channels';
  constructor(
    private readonly byChannel: Record<string, NotificationTransport>,
    private readonly fallback: NotificationTransport,
  ) {}

  send(m: OutgoingMessage): Promise<void> {
    return (this.byChannel[m.channel] ?? this.fallback).send(m);
  }
}

// ---------------------------------------------------------------------------------------------------
// Conexión del chat del negocio

/** Crea un enlace de conexión de un solo uso para el negocio (sustituye al anterior). */
export async function createTelegramLink(
  db: Db,
  bot: TelegramBot,
  actor: Actor,
  now: Date,
): Promise<{ url: string; expiresAt: Date }> {
  const code = newToken(); // 43 caracteres base64url: válido como parámetro de /start (máx. 64)
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_MINUTES * 60_000);
  const username = await bot.botUsername();
  await db.tenant.update({
    where: { id: actor.tenantId },
    data: { telegramLinkTokenHash: sha256(code), telegramLinkExpiresAt: expiresAt },
  });
  return { url: `https://t.me/${username}?start=${code}`, expiresAt };
}

/** Desconecta el chat del negocio. */
export async function unlinkTelegram(db: Db, actor: Actor): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: actor.tenantId },
      data: { telegramChatId: null, telegramLinkedAt: null, telegramLinkTokenHash: null, telegramLinkExpiresAt: null },
    });
    await writeAudit(tx, { ...actor, action: 'tenant.telegram_unlinked', entityType: 'Tenant', entityId: actor.tenantId });
  });
}

/**
 * Procesa un mensaje recibido por el bot. `/start <código>` válido y vigente → conecta ese chat al negocio
 * del código (una sola vez) y responde. Cualquier otra cosa → instrucciones. Nunca revela datos de un
 * negocio a quien no tiene un código válido.
 */
export async function handleTelegramUpdate(db: Db, bot: TelegramBot, update: TelegramUpdate, now: Date): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  const chatId = String(message.chat.id);
  const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{20,64})\s*$/.exec(message.text.trim());
  if (!match) {
    await bot.sendMessage(chatId, 'Para recibir aquí los avisos de tu negocio, pulsa «Conectar Telegram» en Ajustes del panel.');
    return;
  }
  // Tenant es legible sin negocio fijado (RLS); la escritura se hace con el negocio del código.
  const tenant = await db.tenant.findUnique({
    where: { telegramLinkTokenHash: sha256(match[1]!) },
    select: { id: true, name: true, telegramLinkExpiresAt: true },
  });
  if (!tenant || !tenant.telegramLinkExpiresAt || tenant.telegramLinkExpiresAt <= now) {
    await bot.sendMessage(chatId, 'Este enlace no es válido o ha caducado. Genera uno nuevo en Ajustes del panel.');
    return;
  }
  await withTenant(tenant.id, () =>
    db.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { telegramChatId: chatId, telegramLinkedAt: now, telegramLinkTokenHash: null, telegramLinkExpiresAt: null },
      });
      await writeAudit(tx, {
        tenantId: tenant.id,
        actorType: 'SYSTEM',
        actorUserId: null,
        action: 'tenant.telegram_linked',
        entityType: 'Tenant',
        entityId: tenant.id,
        after: { chatType: message.chat.type },
        ip: null,
        requestId: null,
      });
    }),
  );
  await bot.sendMessage(chatId, `✅ Conectado. Aquí recibirás los avisos de <b>${escapeHtml(tenant.name)}</b> (reservas nuevas desde la web).`);
}

/**
 * Bucle que recibe los mensajes del bot (sondeo largo). Solo debe correr en una instancia (la del worker):
 * Telegram rechaza dos getUpdates simultáneos del mismo bot.
 */
export function startTelegramLinker(
  db: Db,
  bot: TelegramBot,
  log: { warn: (obj: unknown, msg: string) => void },
  options: { pollSeconds?: number; retryMs?: number; now?: () => Date } = {},
): () => Promise<void> {
  const { pollSeconds = 25, retryMs = 5_000, now = () => new Date() } = options;
  const abort = new AbortController();
  let offset = 0;
  const loop = (async () => {
    while (!abort.signal.aborted) {
      try {
        const updates = await bot.getUpdates(offset, pollSeconds, abort.signal);
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            await handleTelegramUpdate(db, bot, u, now());
          } catch (err) {
            log.warn({ err: (err as Error).message }, 'telegram: no se pudo procesar un mensaje');
          }
        }
      } catch (err) {
        if (abort.signal.aborted) break;
        log.warn({ err: (err as Error).message }, 'telegram: error al consultar mensajes; se reintenta');
        await new Promise<void>((r) => {
          const timer = setTimeout(r, retryMs);
          abort.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            r();
          });
        });
      }
    }
  })();
  return async () => {
    abort.abort();
    await loop;
  };
}
