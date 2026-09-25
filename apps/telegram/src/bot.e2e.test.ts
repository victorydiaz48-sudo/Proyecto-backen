import { MockVisionProvider, type VisionProvider } from '@autocontent/providers';
import { ImageValidationError, InMemoryJobQueue, silentLogger } from '@autocontent/shared';
import { makePng } from '@autocontent/shared/testing';
import { Api, type RawApi, type Transformer } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import { createBot } from './bot.js';
import { createAnalyzePhotoHandler, failureMessage, type AnalyzePhotoPayload } from './pipeline.js';
import type { TelegramFileFetcher } from './ports.js';
import { createNotifier } from './telegram-io.js';

const TOKEN = '123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';
const CHAT_ID = 4242;
const limits = { maxBytes: 5 * 1024 * 1024, minDimension: 320, maxDimension: 8000 };

interface Sent {
  method: string;
  text: string;
  parse_mode?: string;
}

/** Wire the real bot + queue + pipeline, with Telegram's HTTP API replaced by a recorder. */
function harness(opts: { files?: TelegramFileFetcher; vision?: VisionProvider } = {}) {
  const sent: Sent[] = [];
  const recorder: Transformer<RawApi> = async (_prev, method, payload) => {
    const p = payload as { text?: string; parse_mode?: string };
    sent.push({ method, text: p.text ?? '', parse_mode: p.parse_mode });
    const result =
      method === 'sendMessage'
        ? { message_id: sent.length, date: 0, chat: { id: CHAT_ID, type: 'private' }, text: p.text }
        : true;
    return { ok: true, result } as never;
  };

  const api = new Api(TOKEN);
  api.config.use(recorder);
  const notifier = createNotifier(api);
  const files: TelegramFileFetcher = opts.files ?? { download: async () => makePng(1080, 1080, 3) };

  const queue = new InMemoryJobQueue<AnalyzePhotoPayload>(
    createAnalyzePhotoHandler({ vision: opts.vision ?? new MockVisionProvider(), notifier, files, limits, mockMode: true }),
    {
      retry: { maxAttempts: 3, baseDelayMs: 1 },
      onFinalFailure: async (p, err) => notifier.sendText(p.chatId, failureMessage(err, p.locale, limits)),
    },
  );

  const bot = createBot({
    token: TOKEN,
    queue,
    logger: silentLogger,
    limits,
    locale: 'es',
    botInfo: {
      id: 123456789,
      is_bot: true,
      first_name: 'Test',
      username: 'test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    } as UserFromGetMe,
  });
  bot.api.config.use(recorder);

  let updateId = 1;
  const message = (extra: Record<string, unknown>, messageId = updateId) =>
    bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: messageId,
        date: 1_700_000_000,
        chat: { id: CHAT_ID, type: 'private', first_name: 'Ana' },
        from: { id: 77, is_bot: false, first_name: 'Ana' },
        ...extra,
      },
    } as Update);

  const photo = (messageId?: number) =>
    message(
      {
        photo: [
          { file_id: 'small', file_unique_id: 's', width: 90, height: 90, file_size: 1000 },
          { file_id: 'large', file_unique_id: 'l', width: 1080, height: 1080, file_size: 200_000 },
        ],
      },
      messageId,
    );

  return { sent, queue, message, photo };
}

describe('walking skeleton: Telegram photo → mock analysis → caption', () => {
  it('acknowledges immediately, then replies with analysis and caption', async () => {
    const h = harness();
    await h.photo();

    // The update handler only acknowledges; heavy work happens in the queue.
    expect(h.sent.map((s) => s.text)).toEqual(['🚗 Analizando tu vehículo…']);

    await h.queue.onIdle();
    expect(h.sent).toHaveLength(3);
    const [, analysis, caption] = h.sent;
    expect(analysis!.parse_mode).toBe('HTML');
    expect(analysis!.text).toContain('Modo demo');
    expect(analysis!.text).toMatch(/detectado|inferido/);
    expect(analysis!.text).toContain('precio');
    expect(caption!.text).toContain('Texto para publicar');
    expect(caption!.text).toContain('#AutosEnVenta');
  });

  it('ignores a redelivered update for the same message (idempotent)', async () => {
    const h = harness();
    await h.photo(10);
    await h.photo(10);
    await h.queue.onIdle();
    expect(h.sent.filter((s) => s.text.includes('Analizando'))).toHaveLength(1);
    expect(h.sent).toHaveLength(3);
  });

  it('downloads the largest photo size', async () => {
    const requested: string[] = [];
    const h = harness({
      files: {
        download: async (id) => {
          requested.push(id);
          return makePng(800, 600);
        },
      },
    });
    await h.photo();
    await h.queue.onIdle();
    expect(requested).toEqual(['large']);
  });

  it('rejects an oversized photo without enqueuing it', async () => {
    const h = harness();
    await h.message({
      photo: [{ file_id: 'big', file_unique_id: 'b', width: 4000, height: 3000, file_size: 50 * 1024 * 1024 }],
    });
    await h.queue.onIdle();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toContain('demasiado grande');
  });

  it('refuses non-image documents and validates bytes of image documents', async () => {
    const h = harness({ files: { download: async () => Buffer.from('%PDF-1.7 fake') } });
    await h.message({ document: { file_id: 'd1', file_unique_id: 'd1', mime_type: 'application/pdf' } });
    expect(h.sent.at(-1)!.text).toContain('Solo acepto');

    // Claims to be an image but isn't: caught by magic-byte validation, not retried.
    await h.message({ document: { file_id: 'd2', file_unique_id: 'd2', mime_type: 'image/jpeg' } });
    await h.queue.onIdle();
    expect(h.sent.at(-1)!.text).toContain('Solo acepto');
    expect(h.sent.filter((s) => s.text.includes('Analizando'))).toHaveLength(1);
  });

  it('tells the user when the photo is too small', async () => {
    const h = harness({ files: { download: async () => makePng(200, 150) } });
    await h.photo();
    await h.queue.onIdle();
    expect(h.sent.at(-1)!.text).toContain('demasiado pequeña');
  });

  it('retries a flaky vision provider and still delivers exactly once', async () => {
    let calls = 0;
    const mock = new MockVisionProvider();
    const flaky: VisionProvider = {
      name: 'flaky',
      testConnection: () => mock.testConnection(),
      analyze: async (input) => {
        if (++calls === 1) throw new Error('timeout');
        return mock.analyze(input);
      },
    };
    const h = harness({ vision: flaky });
    await h.photo();
    await h.queue.onIdle();
    expect(calls).toBe(2);
    expect(h.sent).toHaveLength(3);
  });

  it('sends one friendly failure message when all attempts fail', async () => {
    const h = harness({
      vision: {
        name: 'down',
        testConnection: async () => ({ provider: 'down', state: 'ERROR' }),
        analyze: async () => {
          throw new Error('503');
        },
      },
    });
    await h.photo();
    await h.queue.onIdle();
    expect(h.sent.map((s) => s.text)).toEqual([
      '🚗 Analizando tu vehículo…',
      '❌ No pude procesar la foto. Inténtalo de nuevo en unos minutos.',
    ]);
  });

  it('answers text messages and /start', async () => {
    const h = harness();
    await h.message({ text: 'hola' });
    await h.message({ text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] });
    expect(h.sent[0]!.text).toContain('Envíame una foto');
    expect(h.sent[1]!.text).toContain('¡Hola!');
  });

  it('maps validation errors to localized messages', () => {
    expect(failureMessage(new ImageValidationError('corrupt', 'x'), 'pt', limits)).toContain('Não consegui ler');
  });
});
