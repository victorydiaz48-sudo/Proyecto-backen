import { createServer } from 'node:http';
import { loadConfig, ConfigError } from '@autocontent/config';
import { createVisionProvider } from '@autocontent/providers';
import { InMemoryQueue } from '@autocontent/queue';
import { createLogger, redactSecrets, type ImageLimits } from '@autocontent/shared';
import { Api } from 'grammy';
import { createBot } from './bot.js';
import { createAnalyzePhotoHandler, failureMessage, type AnalyzePhotoPayload } from './pipeline.js';
import { WEBHOOK_PATH, createHttpServer } from './server.js';
import { createFileFetcher, createNotifier } from './telegram-io.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger({
    level: config.LOG_LEVEL,
    bindings: { service: 'telegram' },
    redact: [config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_WEBHOOK_SECRET, config.AI_API_KEY],
  });

  if (!config.TELEGRAM_BOT_TOKEN) {
    logger.error('TELEGRAM_BOT_TOKEN is not set: Telegram is NOT CONFIGURED. Serving /health only.');
  }

  const limits: ImageLimits = {
    maxBytes: config.MAX_IMAGE_BYTES,
    minDimension: config.MIN_IMAGE_DIMENSION,
    maxDimension: config.MAX_IMAGE_DIMENSION,
  };
  const vision = createVisionProvider(config);
  const visionStatus = await vision.testConnection();
  logger.info('vision provider ready', { ...visionStatus, mockMode: config.MOCK_MODE });

  if (!config.TELEGRAM_BOT_TOKEN) {
    // Keep the service up so the deploy is healthy and the misconfiguration is visible.
    const server = createServer((_, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'degraded', telegram: 'NOT_CONFIGURED', vision: visionStatus.state }));
    });
    server.listen(config.PORT);
    return;
  }

  const token = config.TELEGRAM_BOT_TOKEN;
  // Outbound API client used by the job pipeline (independent of update handling).
  const api = new Api(token);
  const notifier = createNotifier(api);

  const queue = new InMemoryQueue<AnalyzePhotoPayload>({
    logger,
    retry: { maxRetries: config.JOB_MAX_RETRIES, baseDelayMs: 2000 },
  });
  queue.process(
    createAnalyzePhotoHandler({
      vision,
      notifier,
      files: createFileFetcher(api, token),
      limits,
      mockMode: config.MOCK_MODE,
    }),
    {
      concurrency: 4,
      onFinalFailure: async (p, err) => {
        await notifier.sendText(p.chatId, failureMessage(err, p.locale, limits));
      },
    },
  );

  const bot = createBot({ token, queue, logger, limits, locale: config.DEFAULT_LOCALE });

  const server = createHttpServer({
    bot,
    logger,
    mode: config.TELEGRAM_MODE,
    webhookSecret: config.TELEGRAM_WEBHOOK_SECRET,
    health: () => ({
      telegram: 'CONFIGURED',
      mode: config.TELEGRAM_MODE,
      vision: visionStatus.state,
      mockMode: config.MOCK_MODE,
    }),
  });
  server.listen(config.PORT, () => logger.info('http server listening', { port: config.PORT }));

  let stopping = false;
  const shutdown = async (signal: string) => {
    stopping = true;
    logger.info('shutting down', { signal });
    if (config.TELEGRAM_MODE === 'polling') {
      await bot.stop().catch((err: unknown) => logger.warn('bot.stop failed', { err }));
    }
    await queue.close();
    server.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  // Cosmetic (command menu in the Telegram UI): never fatal.
  await bot.api
    .setMyCommands([
      { command: 'start', description: 'Start' },
      { command: 'help', description: 'Help' },
    ])
    .catch((err: unknown) => logger.warn('could not set bot commands', { err }));

  const telegramFatal = (err: unknown) => {
    if (stopping) return;
    logger.error(
      'Telegram rejected the connection. Check that TELEGRAM_BOT_TOKEN is correct and that no other ' +
        'deployment is running the same bot in polling mode.',
      { err },
    );
    process.exit(1);
  };

  if (config.TELEGRAM_MODE === 'webhook') {
    const url = new URL(WEBHOOK_PATH, config.TELEGRAM_WEBHOOK_URL).toString();
    await bot.init().catch(telegramFatal);
    await bot.api
      .setWebhook(url, { secret_token: config.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'] })
      .catch(telegramFatal);
    logger.info('telegram webhook registered', { url });
  } else {
    // bot.start() removes any previously registered webhook before polling.
    bot
      .start({
        allowed_updates: ['message'],
        onStart: (me) => logger.info('telegram polling started', { bot: me.username }),
      })
      .catch(telegramFatal);
  }
}

main().catch((err: unknown) => {
  const secrets = [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_WEBHOOK_SECRET, process.env.AI_API_KEY];
  console.error(redactSecrets(JSON.stringify({ level: 'error', msg: 'fatal startup error', err: String(err) }), secrets));
  process.exit(1);
});
