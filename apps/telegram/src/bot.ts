import {
  START_PAYLOAD,
  buildSettingsSnapshot,
  claimBootstrap,
  createTelegramContentJob,
  createTelegramInvite,
  effectiveRole,
  findTelegramAccount,
  redeemTelegramInvite,
  resolveLocale,
  type LinkResult,
  type PrismaClient,
  type Role,
  type SettingsService,
  type TelegramAccountInfo,
} from '@autocontent/database';
import type { JobQueue } from '@autocontent/queue';
import {
  LOCALES,
  messages,
  type ContentJobPayload,
  type ImageLimits,
  type Locale,
  type Logger,
} from '@autocontent/shared';
import { Bot, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { FixedWindowRateLimiter } from './rate-limit.js';

export interface BotDeps {
  token: string;
  prisma: PrismaClient;
  settings: SettingsService;
  queue: JobQueue<ContentJobPayload>;
  logger: Logger;
  limits: ImageLimits;
  defaultLocale: Locale;
  bootstrapCode?: string;
  /** Organization the bootstrap code claims (default: the seeded demo organization). */
  bootstrapOrganizationSlug?: string;
  /** Pre-supplied bot identity (tests) — skips the getMe call on startup. */
  botInfo?: UserFromGetMe;
  rateLimit?: { max: number; windowMs: number };
  inviteHours?: number;
}

const INVITE_ROLE_ARGS: Record<string, Role> = {
  operator: 'OPERATOR',
  operador: 'OPERATOR',
  editor: 'EDITOR',
  admin: 'ADMIN',
  administrador: 'ADMIN',
};

/**
 * Telegram front door. Update handlers only look things up, write the job row
 * and enqueue — downloads and AI calls happen in the worker.
 *
 * Access is invite-only: unknown Telegram users can only redeem an invite
 * link or the one-time bootstrap code.
 */
export function createBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.token, deps.botInfo ? { botInfo: deps.botInfo } : undefined);
  const log = deps.logger;
  const limiter = new FixedWindowRateLimiter(deps.rateLimit?.max ?? 20, deps.rateLimit?.windowMs ?? 60_000);
  const inviteHours = deps.inviteHours ?? 72;

  /** Language for people we don't know yet: their Telegram app language if supported. */
  const guestLocale = (ctx: Context): Locale => {
    const code = ctx.from?.language_code?.slice(0, 2);
    return (LOCALES as readonly string[]).includes(code ?? '') ? (code as Locale) : deps.defaultLocale;
  };

  const accountLocale = async (a: TelegramAccountInfo): Promise<Locale> => {
    const s = await deps.settings.get(a.organizationId);
    return resolveLocale({ telegramOverride: a.localeOverride, organizationLocale: s.settings.locale, fallback: deps.defaultLocale });
  };

  // Abuse protection: cap updates per Telegram user before touching the database.
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (id !== undefined && !limiter.allow(String(id))) {
      log.warn('rate limited telegram user', { telegramUserId: id });
      return;
    }
    await next();
  });

  /** Loads the sender's account and rejects blocked users / suspended organizations. */
  const requireAccount = async (ctx: Context): Promise<{ account: TelegramAccountInfo; locale: Locale } | null> => {
    const from = ctx.from;
    if (!from) return null;
    const account = await findTelegramAccount(deps.prisma, BigInt(from.id));
    if (!account) {
      await ctx.reply(messages(guestLocale(ctx)).access.needInvite);
      return null;
    }
    const locale = await accountLocale(account);
    const m = messages(locale);
    if (account.status !== 'ACTIVE') {
      await ctx.reply(m.access.blocked);
      return null;
    }
    if (account.organization.status !== 'ACTIVE') {
      await ctx.reply(m.access.suspended);
      return null;
    }
    return { account, locale };
  };

  bot.command('start', async (ctx) => {
    const from = ctx.from!;
    const payload = ctx.match.trim();
    if (!payload) {
      const account = await findTelegramAccount(deps.prisma, BigInt(from.id));
      if (!account) return void (await ctx.reply(messages(guestLocale(ctx)).access.needInvite));
      return void (await ctx.reply(messages(await accountLocale(account)).welcome, { parse_mode: 'HTML' }));
    }

    const identity = {
      telegramUserId: BigInt(from.id),
      chatId: BigInt(ctx.chat.id),
      username: from.username ?? null,
      firstName: from.first_name ?? null,
    };
    let result: LinkResult = { status: 'invalid' };
    if (START_PAYLOAD.test(payload)) {
      result = await claimBootstrap(deps.prisma, {
        code: payload,
        expectedCode: deps.bootstrapCode,
        identity,
        organizationSlug: deps.bootstrapOrganizationSlug,
      });
      if (result.status === 'invalid') result = await redeemTelegramInvite(deps.prisma, { code: payload, identity });
    }

    const account = result.status === 'linked' || result.status === 'already_linked' ? await findTelegramAccount(deps.prisma, identity.telegramUserId) : null;
    const m = messages(account ? await accountLocale(account) : guestLocale(ctx));
    switch (result.status) {
      case 'linked':
        log.info('telegram account linked', { organizationId: result.organizationId, role: result.role });
        return void (await ctx.reply(m.access.linked(m.roles[result.role]), { parse_mode: 'HTML' }));
      case 'already_linked':
        return void (await ctx.reply(m.access.alreadyLinked));
      case 'already_claimed':
        return void (await ctx.reply(m.access.alreadyClaimed));
      case 'invalid':
        log.info('invalid start payload', { telegramUserId: from.id });
        return void (await ctx.reply(m.access.inviteInvalid));
    }
  });

  bot.command('help', async (ctx) => {
    const account = ctx.from ? await findTelegramAccount(deps.prisma, BigInt(ctx.from.id)) : null;
    await ctx.reply(messages(account ? await accountLocale(account) : guestLocale(ctx)).help);
  });

  bot.command('invite', async (ctx) => {
    const r = await requireAccount(ctx);
    if (!r) return;
    const m = messages(r.locale);
    const arg = ctx.match.trim().toLowerCase();
    const role = arg ? INVITE_ROLE_ARGS[arg] : 'OPERATOR';
    if (!role) return void (await ctx.reply(m.access.inviteUsage));

    const inv = await createTelegramInvite(deps.prisma, {
      organizationId: r.account.organizationId,
      inviterRole: effectiveRole(r.account),
      inviterAccountId: r.account.id,
      role,
      expiresInHours: inviteHours,
    });
    if ('error' in inv) return void (await ctx.reply(m.access.inviteForbidden));
    const link = `https://t.me/${ctx.me.username}?start=${inv.code}`;
    log.info('telegram invite created', { organizationId: r.account.organizationId, role });
    await ctx.reply(m.access.inviteCreated(link, m.roles[role], inviteHours), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  const accept = async (ctx: Context, fileId: string, declaredSize: number | undefined) => {
    const r = await requireAccount(ctx);
    if (!r) return;
    const m = messages(r.locale);
    if (declaredSize !== undefined && declaredSize > deps.limits.maxBytes) {
      return void (await ctx.reply(m.imageTooLarge(Math.floor(deps.limits.maxBytes / (1024 * 1024)))));
    }

    const ctxSettings = await deps.settings.get(r.account.organizationId);
    const snapshot = { ...buildSettingsSnapshot(ctxSettings), locale: r.locale };
    const result = await createTelegramContentJob(deps.prisma, {
      organizationId: r.account.organizationId,
      telegramAccountId: r.account.id,
      // Same Telegram message → same job, so redelivered updates are duplicates.
      idempotencyKey: `tg:${ctx.me.id}:${ctx.chat!.id}:${ctx.msg!.message_id}`,
      telegramFileId: fileId,
      telegramChatId: BigInt(ctx.chat!.id),
      telegramMessageId: ctx.msg!.message_id,
      snapshot,
    });

    switch (result.status) {
      case 'limit_reached':
        log.info('job refused: limit reached', { organizationId: r.account.organizationId, limit: result.limit });
        return void (await ctx.reply(result.limit === 'daily_jobs' ? m.access.dailyLimit : m.access.monthlyLimit));
      case 'duplicate':
        // Re-enqueue in case the first enqueue was lost; the queue dedupes by id.
        if (result.jobStatus === 'PENDING') {
          await deps.queue.enqueue({ contentJobId: result.jobId, organizationId: r.account.organizationId }, { jobId: result.jobId });
        }
        log.info('duplicate update ignored', { jobId: result.jobId });
        return;
      case 'created':
        await deps.queue.enqueue({ contentJobId: result.jobId, organizationId: r.account.organizationId }, { jobId: result.jobId });
        log.info('job enqueued', { jobId: result.jobId, organizationId: r.account.organizationId });
        await ctx.reply(m.analyzing);
    }
  };

  bot.on('message:photo', async (ctx) => {
    // Telegram sends several sizes; the last one is the largest.
    const photo = ctx.msg.photo.at(-1)!;
    await accept(ctx, photo.file_id, photo.file_size);
  });

  // Photos sent "as file" keep full quality. The mime type is only a hint;
  // the worker verifies the real type from the bytes.
  bot.on('message:document', async (ctx) => {
    const doc = ctx.msg.document;
    if (!doc.mime_type?.startsWith('image/')) {
      const account = await findTelegramAccount(deps.prisma, BigInt(ctx.from.id));
      return void (await ctx.reply(messages(account ? await accountLocale(account) : guestLocale(ctx)).unsupportedFile));
    }
    await accept(ctx, doc.file_id, doc.file_size);
  });

  bot.on('message', async (ctx) => {
    const r = await requireAccount(ctx);
    if (r) await ctx.reply(messages(r.locale).sendPhoto);
  });

  bot.catch((err) => {
    log.error('telegram update handler failed', { err: err.error, updateId: err.ctx.update.update_id });
  });

  return bot;
}

/**
 * Stand-in bot for a deployment without a database: answers every message
 * with a clear "not configured" notice instead of crashing or staying silent.
 */
export function createUnconfiguredBot(token: string, locale: Locale, botInfo?: UserFromGetMe): Bot {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  bot.on('message', (ctx) => ctx.reply(messages(locale).access.notConfigured));
  return bot;
}
