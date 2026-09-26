import type { Server } from 'node:http';
import { ConfigError, loadConfig, type AppConfig } from '@autocontent/config';
import { SettingsService, createPrismaClient, findUnfinishedJobs, seed, type PrismaClient } from '@autocontent/database';
import {
  createFileFetcher,
  createNotifier,
  createStorageProvider,
  type ProviderStatus,
} from '@autocontent/providers';
import { createQueue, type Queue } from '@autocontent/queue';
import { CONTENT_JOBS_QUEUE, createLogger, redactSecrets, type ContentJobPayload, type Logger } from '@autocontent/shared';
import { WEBHOOK_PATH, createBot, createHttpServer, createUnconfiguredBot } from '@autocontent/telegram';
import type { HealthReport } from '@autocontent/telegram';
import { createDealershipVisionProvider, dealershipModule } from '@autocontent/verticals-dealership';
import { createContentJobProcessor } from '@autocontent/worker';
import { Api, type Bot } from 'grammy';

/** Passwords inside connection strings, so the logger can redact them. */
function urlPassword(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return decodeURIComponent(new URL(url).password) || undefined;
  } catch {
    return undefined;
  }
}

function secretsOf(env: Record<string, string | undefined>): (string | undefined)[] {
  return [
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_WEBHOOK_SECRET,
    env.AI_API_KEY,
    env.STORAGE_SECRET_KEY,
    env.BOOTSTRAP_CODE,
    env.ENCRYPTION_KEYS,
    urlPassword(env.DATABASE_URL),
    urlPassword(env.REDIS_URL),
  ];
}

async function startTelegram(bot: Bot, config: AppConfig, logger: Logger, commands: { command: string; description: string }[]) {
  const fatal = (err: unknown) => {
    logger.error(
      'Telegram rejected the connection. Check that TELEGRAM_BOT_TOKEN is correct and that no other ' +
        'deployment is running the same bot in polling mode.',
      { err },
    );
    process.exit(1);
  };
  // Cosmetic (command menu in the Telegram UI): never fatal.
  await bot.api.setMyCommands(commands).catch((err: unknown) => logger.warn('could not set bot commands', { err }));

  if (config.TELEGRAM_MODE === 'webhook') {
    const url = new URL(WEBHOOK_PATH, config.TELEGRAM_WEBHOOK_URL).toString();
    await bot.init().catch(fatal);
    await bot.api
      .setWebhook(url, { secret_token: config.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'] })
      .catch(fatal);
    logger.info('telegram webhook registered', { url });
  } else {
    // bot.start() removes any previously registered webhook before polling.
    bot
      .start({
        allowed_updates: ['message'],
        onStart: (me) => logger.info('telegram polling started', { bot: me.username }),
      })
      .catch((err: unknown) => {
        if (!stopping) fatal(err);
      });
  }
}

let stopping = false;

async function main() {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger({ level: config.LOG_LEVEL, bindings: { service: config.SERVICE }, redact: secretsOf(process.env) });
  const runBot = config.SERVICE === 'all' || config.SERVICE === 'telegram';
  const runWorker = config.SERVICE === 'all' || config.SERVICE === 'worker';
  const token = config.TELEGRAM_BOT_TOKEN;
  // Every organization is enrolled in the dealership vertical for now (seed() does
  // this); a future phase resolves the vertical per-organization through the
  // VerticalRegistry instead of this single hardcoded module.
  const vertical = dealershipModule;
  const vision = createDealershipVisionProvider(config);
  const visionStatus = await vision.testConnection();
  const limits = { maxBytes: config.MAX_IMAGE_BYTES, minDimension: config.MIN_IMAGE_DIMENSION, maxDimension: config.MAX_IMAGE_DIMENSION };
  const commands = [
    { command: 'start', description: 'Start' },
    { command: 'help', description: 'Help' },
    { command: 'invite', description: 'Invite someone' },
  ];

  let server: Server;
  let bot: Bot | undefined;
  let prisma: PrismaClient | undefined;
  let queue: Queue<ContentJobPayload> | undefined;

  const shutdown = async (signal: string) => {
    stopping = true;
    logger.info('shutting down', { signal });
    if (bot && config.TELEGRAM_MODE === 'polling') await bot.stop().catch((err: unknown) => logger.warn('bot.stop failed', { err }));
    await queue?.close().catch((err: unknown) => logger.warn('queue close failed', { err }));
    await prisma?.$disconnect().catch(() => undefined);
    server?.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  // ── Degraded mode: no database. Stay up, say so, never crash-loop. ─────────
  if (!config.DATABASE_URL) {
    logger.error('DATABASE_URL is not set: database NOT CONFIGURED. Add a PostgreSQL service (see SETUP.md).');
    if (runBot && token) bot = createUnconfiguredBot(token, config.DEFAULT_LOCALE);
    server = createHttpServer({
      bot,
      logger,
      mode: config.TELEGRAM_MODE,
      webhookSecret: config.TELEGRAM_WEBHOOK_SECRET,
      health: () => ({
        status: 'degraded',
        ready: false,
        service: config.SERVICE,
        database: 'NOT_CONFIGURED',
        telegram: token ? 'CONFIGURED' : 'NOT_CONFIGURED',
        vision: visionStatus.state,
        mockMode: config.MOCK_MODE,
      }),
    });
    server.listen(config.PORT, () => logger.info('http server listening', { port: config.PORT }));
    if (bot) await startTelegram(bot, config, logger, commands);
    return;
  }

  // ── Full mode ──────────────────────────────────────────────────────────────
  prisma = createPrismaClient(config.DATABASE_URL);
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.error('Cannot reach the database. Check DATABASE_URL and that the PostgreSQL service is running.', { err });
    process.exit(1);
  }
  const seeded = await seed(prisma);
  logger.info('database ready', { demoOrganizationId: seeded.organizationId });

  const { storage, durable } = createStorageProvider(config);
  const storageStatus = await storage.testConnection();
  logger[storageStatus.state === 'CONNECTED' ? 'info' : 'error']('storage', { ...storageStatus, durable });
  if (!durable) logger.warn('Photos are stored on local disk and will be lost on redeploy. Configure STORAGE_* (see SETUP.md).');

  queue = createQueue<ContentJobPayload>(CONTENT_JOBS_QUEUE, {
    redisUrl: config.REDIS_URL,
    retry: { maxRetries: config.JOB_MAX_RETRIES, baseDelayMs: 2000 },
    logger,
  });
  if (queue.backend === 'memory') logger.warn('REDIS_URL is not set: jobs run in memory; unfinished jobs are re-queued from the database at startup.');

  if (runWorker) {
    if (!token) {
      logger.error('Worker not started: TELEGRAM_BOT_TOKEN is required to download photos and reply.');
    } else {
      const api = new Api(token);
      const processor = createContentJobProcessor({
        prisma,
        storage,
        vision,
        vertical,
        notifier: createNotifier(api),
        files: createFileFetcher(api, token),
        limits,
        mockMode: config.MOCK_MODE,
      });
      queue.process(processor.handler, { concurrency: config.WORKER_CONCURRENCY, onFinalFailure: processor.onFinalFailure });
      // Re-queue work accepted before a restart (the queue ignores ids it already has).
      const unfinished = await findUnfinishedJobs(prisma);
      for (const j of unfinished) await queue.enqueue({ contentJobId: j.id, organizationId: j.organizationId }, { jobId: j.id });
      logger.info('worker started', { backend: queue.backend, concurrency: config.WORKER_CONCURRENCY, requeued: unfinished.length });
    }
  }

  if (runBot && token) {
    bot = createBot({
      token,
      prisma,
      settings: new SettingsService(prisma),
      queue,
      logger,
      limits,
      defaultLocale: config.DEFAULT_LOCALE,
      bootstrapCode: config.BOOTSTRAP_CODE,
    });
  } else if (runBot) {
    logger.error('TELEGRAM_BOT_TOKEN is not set: Telegram is NOT CONFIGURED.');
  }

  const health = async (): Promise<HealthReport> => {
    const warnings: string[] = [];
    const database = await prisma!.$queryRaw`SELECT 1`.then(
      () => 'CONNECTED' as const,
      () => 'ERROR' as const,
    );
    const q = queue!;
    const queueState = q.backend === 'redis' ? ((await (q as unknown as { ping(): Promise<boolean> }).ping()) ? 'CONNECTED' : 'ERROR') : 'IN_MEMORY';
    if (queueState === 'IN_MEMORY') warnings.push('Queue runs in memory (set REDIS_URL for durable jobs).');
    if (!durable) warnings.push('Photos are stored on local disk and are lost on redeploy (set STORAGE_*).');
    if (config.MOCK_MODE) warnings.push('MOCK_MODE is on: vehicle analysis is simulated.');
    const ready = database === 'CONNECTED' && queueState !== 'ERROR' && storageStatus.state === 'CONNECTED';
    return {
      status: ready ? 'ok' : 'degraded',
      ready,
      service: config.SERVICE,
      database,
      queue: { backend: q.backend, state: queueState },
      storage: { provider: storage.name, state: storageStatus.state as ProviderStatus['state'], durable },
      telegram: token ? 'CONFIGURED' : 'NOT_CONFIGURED',
      mode: config.TELEGRAM_MODE,
      vision: { provider: vision.name, state: visionStatus.state },
      mockMode: config.MOCK_MODE,
      warnings,
    };
  };

  server = createHttpServer({ bot, logger, mode: config.TELEGRAM_MODE, webhookSecret: config.TELEGRAM_WEBHOOK_SECRET, health });
  server.listen(config.PORT, () => logger.info('http server listening', { port: config.PORT }));
  if (bot) await startTelegram(bot, config, logger, commands);
}

main().catch((err: unknown) => {
  console.error(redactSecrets(JSON.stringify({ level: 'error', msg: 'fatal startup error', err: String(err) }), secretsOf(process.env)));
  process.exit(1);
});
