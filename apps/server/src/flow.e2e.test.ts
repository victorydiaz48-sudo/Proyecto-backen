import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SettingsService,
  createPrismaClient,
  findUnfinishedJobs,
  forDealership,
  seed,
  type PrismaClient,
} from '@autocontent/database';
import {
  LocalDiskStorageProvider,
  MockVisionProvider,
  createNotifier,
  type TelegramFileFetcher,
  type VisionProvider,
} from '@autocontent/providers';
import { BullMqQueue, InMemoryQueue, type JobQueue, type JobWorker } from '@autocontent/queue';
import { silentLogger, type ContentJobPayload } from '@autocontent/shared';
import { makePng } from '@autocontent/shared/testing';
import { createBot } from '@autocontent/telegram';
import { createContentJobProcessor } from '@autocontent/worker';
import { Api, type RawApi, type Transformer } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Whole Phase 2 flow against real PostgreSQL (and real Redis when available):
 * Telegram update → bot → database → queue → worker → storage → vision (mock)
 * → caption → replies. Telegram's HTTP API is replaced by a recorder.
 */
const DB = process.env.TEST_DATABASE_URL;
if (!DB && process.env.REQUIRE_DB_TESTS === '1') throw new Error('REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set');
const REDIS = process.env.TEST_REDIS_URL;
const TOKEN = '123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';
const BOT_INFO = { id: 123456789, is_bot: true, first_name: 'Test', username: 'test_bot' } as UserFromGetMe;
const limits = { maxBytes: 5 * 1024 * 1024, minDimension: 320, maxDimension: 8000 };

interface Sent {
  chatId: number;
  text: string;
}

let nextUser = Number(String(Date.now()).slice(-9)) * 10;

function world(prisma: PrismaClient, opts: { slug: string; bootstrapCode: string; vision?: VisionProvider; files?: TelegramFileFetcher; queue?: JobQueue<ContentJobPayload> & JobWorker<ContentJobPayload>; storageRoot: string; startWorker?: boolean }) {
  const sent: Sent[] = [];
  const recorder: Transformer<RawApi> = async (_prev, method, payload) => {
    const p = payload as { chat_id?: number; text?: string };
    if (method === 'sendMessage') sent.push({ chatId: Number(p.chat_id), text: p.text ?? '' });
    const result = method === 'sendMessage' ? { message_id: sent.length, date: 0, chat: { id: p.chat_id, type: 'private' }, text: p.text } : true;
    return { ok: true, result } as never;
  };
  const api = new Api(TOKEN);
  api.config.use(recorder);

  const queue = opts.queue ?? new InMemoryQueue<ContentJobPayload>({ retry: { maxRetries: 3, baseDelayMs: 1 } });
  const storage = new LocalDiskStorageProvider(opts.storageRoot, 'x'.repeat(32));
  const downloads: string[] = [];
  const files: TelegramFileFetcher = opts.files ?? {
    download: async (fileId) => {
      downloads.push(fileId);
      // Same file id → same bytes (lets tests send an identical photo twice).
      return makePng(1080, 810, [...fileId].reduce((a, c) => a + c.charCodeAt(0), 0) % 250);
    },
  };
  const processor = createContentJobProcessor({
    prisma,
    storage,
    vision: opts.vision ?? new MockVisionProvider(),
    notifier: createNotifier(api),
    files,
    limits,
    mockMode: true,
  });
  if (opts.startWorker !== false) queue.process(processor.handler, { onFinalFailure: processor.onFinalFailure });

  const bot = createBot({
    token: TOKEN,
    prisma,
    settings: new SettingsService(prisma, 0),
    queue,
    logger: silentLogger,
    limits,
    defaultLocale: 'es',
    bootstrapCode: opts.bootstrapCode,
    bootstrapDealershipSlug: opts.slug,
    botInfo: BOT_INFO,
  });
  bot.api.config.use(recorder);

  let updateId = 1;
  const user = () => {
    const id = nextUser++;
    const send = (extra: Record<string, unknown>, messageId = updateId) =>
      bot.handleUpdate({
        update_id: updateId++,
        message: { message_id: messageId, date: 1_700_000_000, chat: { id, type: 'private', first_name: 'U' }, from: { id, is_bot: false, first_name: 'U', language_code: 'es' }, ...extra },
      } as Update);
    const command = (text: string) => send({ text, entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] });
    const photo = (fileId = `file-${randomUUID()}`, messageId?: number) =>
      send({ photo: [{ file_id: fileId, file_unique_id: fileId, width: 1080, height: 810, file_size: 200_000 }] }, messageId);
    const inbox = () => sent.filter((s) => s.chatId === id).map((s) => s.text);
    return { id, send, command, photo, inbox };
  };

  const settle = async () => {
    if (queue instanceof InMemoryQueue) return queue.onIdle();
    // BullMQ: wait until no job for this world is unfinished in the database.
    const end = Date.now() + 15_000;
    while (Date.now() < end) {
      const open = await prisma.contentJob.count({ where: { dealership: { slug: opts.slug }, status: { in: ['PENDING', 'PROCESSING', 'RETRYING'] } } });
      if (open === 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('jobs did not settle');
  };

  return { user, settle, queue, storage, downloads, sent };
}

describe.skipIf(!DB)('Phase 2 flow (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  const storageRoot = mkdtempSync(join(tmpdir(), 'e2e-storage-'));
  const slugs: string[] = [];
  const newDealership = async () => {
    const slug = `e2e-${randomUUID()}`;
    slugs.push(slug);
    const d = await prisma.dealership.create({ data: { slug, name: 'Autos E2E' } });
    await prisma.dealershipSettings.create({ data: { dealershipId: d.id, timezone: 'America/Sao_Paulo' } });
    return { slug, id: d.id };
  };

  beforeAll(async () => {
    prisma = createPrismaClient(DB!, { maxConnections: 5 });
    await seed(prisma); // provider catalogue (mock-vision)
  });
  afterAll(async () => {
    await prisma.dealership.deleteMany({ where: { slug: { in: slugs } } });
    await prisma.$disconnect();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('unknown users are turned away and nothing is created', async () => {
    const d = await newDealership();
    const w = world(prisma, { slug: d.slug, bootstrapCode: 'bootstrap-code-xyz', storageRoot });
    const stranger = w.user();
    await stranger.photo();
    await stranger.command('/start not-a-valid-code');
    expect(stranger.inbox()[0]).toContain('bot es privado');
    expect(stranger.inbox()[1]).toContain('no es válida');
    expect(await prisma.contentJob.count({ where: { dealershipId: d.id } })).toBe(0);
  });

  it('bootstrap → photo → stored, analysed, captioned, delivered, counted; duplicates ignored', async () => {
    const d = await newDealership();
    const w = world(prisma, { slug: d.slug, bootstrapCode: 'bootstrap-code-abc', storageRoot });
    const owner = w.user();
    await owner.command('/start bootstrap-code-abc');
    expect(owner.inbox()[0]).toContain('propietario');

    await owner.photo('photo-1', 500);
    expect(owner.inbox().at(-1)).toBe('🚗 Analizando tu vehículo…');
    await w.settle();
    await owner.photo('photo-1', 500); // Telegram redelivers the same message
    await w.settle();

    const texts = owner.inbox();
    expect(texts.filter((t) => t.includes('Analizando'))).toHaveLength(1);
    expect(texts.some((t) => t.includes('Modo demo'))).toBe(true);
    expect(texts.some((t) => t.includes('Texto para publicar'))).toBe(true);

    const db = forDealership(prisma, d.id);
    const job = await db.contentJob.findFirstOrThrow({ include: { vehicle: { include: { images: true } }, assets: true } });
    expect(job.status).toBe('COMPLETED');
    expect(job.stage).toBe('DONE');
    expect(job.vehicle.make).not.toBeNull();
    expect(job.vehicle.provenance).toHaveProperty('make');
    expect(job.vehicle.images).toHaveLength(1);
    const img = job.vehicle.images[0]!;
    expect(img.storageKey.startsWith(`dealerships/${d.id}/vehicles/${job.vehicleId}/originals/`)).toBe(true);
    expect((await w.storage.head(img.storageKey))?.bytes).toBe(img.bytes);
    expect(job.assets).toHaveLength(1);
    expect(job.assets[0]!.deliveredAt).not.toBeNull();
    expect(job.analysisDeliveredAt).not.toBeNull();

    expect(await db.generationLog.count({ where: { status: 'SUCCESS', operation: 'VISION_ANALYZE' } })).toBe(1);
    const usage = Object.fromEntries((await db.usage.findMany()).map((u) => [u.metric, u.quantity]));
    expect(usage).toMatchObject({ JOBS_CREATED: 1n, VISION_CALLS: 1n, VEHICLES_PROCESSED: 1n });
  });

  it('invites: owner invites an editor; an identical photo reuses the analysis without a new provider call', async () => {
    const d = await newDealership();
    let visionCalls = 0;
    const mock = new MockVisionProvider();
    const counting: VisionProvider = { ...mock, name: mock.name, kind: 'VISION', capabilities: () => mock.capabilities(), testConnection: () => mock.testConnection(), analyze: (i, o) => (visionCalls++, mock.analyze(i, o)) };
    const w = world(prisma, { slug: d.slug, bootstrapCode: 'bootstrap-code-inv', storageRoot, vision: counting });
    const owner = w.user();
    await owner.command('/start bootstrap-code-inv');
    await owner.command('/invite editor');
    const link = owner.inbox().at(-1)!.match(/https:\/\/t\.me\/test_bot\?start=([A-Za-z0-9_-]+)/);
    expect(link).not.toBeNull();

    const editor = w.user();
    await editor.command(`/start ${link![1]}`);
    expect(editor.inbox()[0]).toContain('editor');

    // A second person trying the same single-use link is refused.
    const late = w.user();
    await late.command(`/start ${link![1]}`);
    expect(late.inbox()[0]).toContain('no es válida');

    await owner.photo('same-photo');
    await w.settle();
    await editor.photo('same-photo'); // identical bytes, different message
    await w.settle();
    expect(visionCalls).toBe(1);
    const db = forDealership(prisma, d.id);
    expect(await db.contentJob.count({ where: { status: 'COMPLETED' } })).toBe(2);
    expect(editor.inbox().some((t) => t.includes('Texto para publicar'))).toBe(true);

    // Editors cannot invite admins; operators cannot invite at all.
    await editor.command('/invite admin');
    expect(editor.inbox().at(-1)).toContain('No tienes permiso');
  });

  it('keeps dealerships isolated end to end', async () => {
    const a = await newDealership();
    const b = await newDealership();
    const wa = world(prisma, { slug: a.slug, bootstrapCode: 'bootstrap-code-aaa', storageRoot });
    const wb = world(prisma, { slug: b.slug, bootstrapCode: 'bootstrap-code-bbb', storageRoot });
    const ownerA = wa.user();
    const ownerB = wb.user();
    await ownerA.command('/start bootstrap-code-aaa');
    await ownerB.command('/start bootstrap-code-bbb');
    // A's bootstrap code does nothing for B's dealership (already claimed there by B).
    await ownerA.photo();
    await ownerB.photo();
    await wa.settle();
    await wb.settle();

    const jobsA = await forDealership(prisma, a.id).contentJob.findMany();
    const jobsB = await forDealership(prisma, b.id).contentJob.findMany();
    expect(jobsA).toHaveLength(1);
    expect(jobsB).toHaveLength(1);
    expect(jobsA[0]!.id).not.toBe(jobsB[0]!.id);
    const imgB = await forDealership(prisma, b.id).vehicleImage.findFirstOrThrow();
    expect(imgB.storageKey.startsWith(`dealerships/${b.id}/`)).toBe(true);
    expect(await forDealership(prisma, a.id).vehicleImage.findUnique({ where: { id: imgB.id } })).toBeNull();
  });

  it('a bad file fails once, clearly, without retries; a flaky provider is retried and charged once', async () => {
    const d = await newDealership();
    let calls = 0;
    const mock = new MockVisionProvider();
    const flaky: VisionProvider = {
      name: mock.name,
      kind: 'VISION',
      capabilities: () => mock.capabilities(),
      testConnection: () => mock.testConnection(),
      analyze: async (i, o) => {
        if (++calls === 1) throw new Error('503 from provider');
        return mock.analyze(i, o);
      },
    };
    const w = world(prisma, {
      slug: d.slug,
      bootstrapCode: 'bootstrap-code-err',
      storageRoot,
      vision: flaky,
      files: { download: async (id) => (id === 'pdf' ? Buffer.from('%PDF-1.7 not an image') : makePng(900, 700, 9)) },
    });
    const owner = w.user();
    await owner.command('/start bootstrap-code-err');

    await owner.photo('pdf');
    await w.settle();
    expect(owner.inbox().at(-1)).toContain('Solo acepto');
    const db = forDealership(prisma, d.id);
    const failed = await db.contentJob.findFirstOrThrow({ where: { telegramFileId: 'pdf' } });
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toMatchObject({ code: 'ImageValidationError' });
    expect(calls).toBe(0); // never reached the provider

    await owner.photo('good');
    await w.settle();
    const ok = await db.contentJob.findFirstOrThrow({ where: { telegramFileId: 'good' } });
    expect(ok.status).toBe('COMPLETED');
    expect(calls).toBe(2);
    const logs = await db.generationLog.findMany({ where: { contentJobId: ok.id }, orderBy: { attempt: 'asc' } });
    expect(logs.map((l) => l.status)).toEqual(['ERROR', 'SUCCESS']);
    const usage = await db.usage.findFirstOrThrow({ where: { metric: 'VISION_CALLS' } });
    expect(usage.quantity).toBe(1n);
  });

  it('enforces the daily limit from the dealership settings', async () => {
    const d = await newDealership();
    await prisma.dealershipSettings.update({ where: { dealershipId: d.id }, data: { dailyJobLimit: 1 } });
    const w = world(prisma, { slug: d.slug, bootstrapCode: 'bootstrap-code-lim', storageRoot });
    const owner = w.user();
    await owner.command('/start bootstrap-code-lim');
    await owner.photo();
    await owner.photo();
    await w.settle();
    expect(owner.inbox().filter((t) => t.includes('límite diario'))).toHaveLength(1);
    expect(await forDealership(prisma, d.id).contentJob.count()).toBe(1);
  });

  it('jobs accepted before a restart are finished after it', async () => {
    const d = await newDealership();
    // "Before": bot accepts the photo, but the process dies before the worker runs.
    const before = world(prisma, { slug: d.slug, bootstrapCode: 'bootstrap-code-rst', storageRoot, startWorker: false });
    const owner = before.user();
    await owner.command('/start bootstrap-code-rst');
    await owner.photo('photo-before-restart');
    const db = forDealership(prisma, d.id);
    expect((await db.contentJob.findFirstOrThrow()).status).toBe('PENDING');

    // "After": fresh in-memory queue + worker; startup recovery re-enqueues from the database.
    const after = world(prisma, { slug: d.slug, bootstrapCode: 'bootstrap-code-rst', storageRoot });
    for (const j of (await findUnfinishedJobs(prisma)).filter((j) => j.dealershipId === d.id)) {
      await after.queue.enqueue({ contentJobId: j.id, dealershipId: j.dealershipId }, { jobId: j.id });
    }
    await after.settle();
    expect((await db.contentJob.findFirstOrThrow()).status).toBe('COMPLETED');
    expect(after.sent.some((s) => s.text.includes('Texto para publicar'))).toBe(true);
  });

  it('repairs a vehicle left without identity when a previous attempt crashed after the analysis', async () => {
    const d = await newDealership();
    const w = world(prisma, { slug: d.slug, bootstrapCode: 'bootstrap-code-rep', storageRoot });
    const owner = w.user();
    await owner.command('/start bootstrap-code-rep');
    await owner.photo('repair');
    await w.settle();
    const db = forDealership(prisma, d.id);
    const job = await db.contentJob.findFirstOrThrow();
    // Simulate the crash window: analysis saved, vehicle identity not yet written, job unfinished.
    await db.vehicle.update({ where: { id: job.vehicleId }, data: { make: null, model: null, provenance: {} } });
    await db.contentJob.update({ where: { id: job.id }, data: { status: 'RETRYING' } });
    await w.queue.enqueue({ contentJobId: job.id, dealershipId: d.id }, { jobId: `${job.id}-retry` });
    await w.settle();
    const v = await db.vehicle.findUniqueOrThrow({ where: { id: job.vehicleId } });
    expect(v.make).not.toBeNull();
    expect(v.provenance).toHaveProperty('make');
    expect(await db.generationLog.count()).toBe(1); // no second provider call
  });

  describe.skipIf(!REDIS)('with Redis (BullMQ)', () => {
    it('runs the same flow through a real Redis queue', async () => {
      const d = await newDealership();
      const queue = new BullMqQueue<ContentJobPayload>(`e2e-${randomUUID()}`, { redisUrl: REDIS!, retry: { maxRetries: 3, baseDelayMs: 10 }, prefix: 'test' });
      try {
        const w = world(prisma, { slug: d.slug, bootstrapCode: 'bootstrap-code-rds', storageRoot, queue });
        const owner = w.user();
        await owner.command('/start bootstrap-code-rds');
        await owner.photo();
        await w.settle();
        expect((await forDealership(prisma, d.id).contentJob.findFirstOrThrow()).status).toBe('COMPLETED');
        expect(owner.inbox().some((t) => t.includes('Texto para publicar'))).toBe(true);
      } finally {
        await queue.close();
      }
    });
  });
});
