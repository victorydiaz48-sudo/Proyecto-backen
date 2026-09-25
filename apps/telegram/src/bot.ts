import type { ImageLimits, JobQueue, Locale, Logger } from '@autocontent/shared';
import { messages, deterministicJobId } from '@autocontent/shared';
import { Bot, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { AnalyzePhotoPayload } from './pipeline.js';

export interface BotDeps {
  token: string;
  queue: JobQueue<AnalyzePhotoPayload>;
  logger: Logger;
  limits: ImageLimits;
  /** Phase 0: one global locale. Phase 2 resolves it per dealership. */
  locale: Locale;
  /** Pre-supplied bot identity (tests) — skips the getMe call on startup. */
  botInfo?: UserFromGetMe;
}

/**
 * Telegram front door. It only validates metadata, acknowledges immediately,
 * and enqueues work — no downloads or AI calls happen inside an update handler.
 */
export function createBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.token, deps.botInfo ? { botInfo: deps.botInfo } : undefined);
  const m = messages(deps.locale);
  const log = deps.logger;

  bot.command('start', (ctx) => ctx.reply(m.welcome, { parse_mode: 'HTML' }));
  bot.command('help', (ctx) => ctx.reply(m.help));

  const accept = async (ctx: Context, fileId: string, declaredSize: number | undefined) => {
    const chatId = ctx.chat!.id;
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    if (declaredSize !== undefined && declaredSize > deps.limits.maxBytes) {
      await ctx.reply(m.imageTooLarge(Math.floor(deps.limits.maxBytes / (1024 * 1024))));
      return;
    }
    // Idempotency: the same Telegram message always maps to the same job id,
    // so a redelivered update is recognised as a duplicate.
    const jobId = deterministicJobId(`tg:${chatId}:${ctx.msg!.message_id}`);
    const { duplicate } = await deps.queue.enqueue(
      {
        jobId,
        chatId,
        telegramUserId: userId,
        fileId,
        locale: deps.locale,
        receivedAt: new Date((ctx.msg!.date ?? Date.now() / 1000) * 1000).toISOString(),
      },
      { jobId },
    );
    if (duplicate) {
      log.info('duplicate update ignored', { jobId });
      return;
    }
    log.info('job enqueued', { jobId, chatId, telegramUserId: userId });
    await ctx.reply(m.analyzing);
  };

  bot.on('message:photo', async (ctx) => {
    // Telegram sends several sizes; the last one is the largest.
    const photo = ctx.msg.photo.at(-1)!;
    await accept(ctx, photo.file_id, photo.file_size);
  });

  // Photos sent "as file" keep full quality; accept them if they claim to be images.
  // The real type is verified from the bytes later — the mime here is only a hint.
  bot.on('message:document', async (ctx) => {
    const doc = ctx.msg.document;
    if (!doc.mime_type?.startsWith('image/')) {
      await ctx.reply(m.unsupportedFile);
      return;
    }
    await accept(ctx, doc.file_id, doc.file_size);
  });

  bot.on('message', (ctx) => ctx.reply(m.sendPhoto));

  bot.catch((err) => {
    log.error('telegram update handler failed', { err: err.error, updateId: err.ctx.update.update_id });
  });

  return bot;
}
