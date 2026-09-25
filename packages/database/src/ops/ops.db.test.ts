import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../client.js';
import { seed } from '../seed.js';
import { SettingsService, buildSettingsSnapshot, type SettingsSnapshot } from '../settings.js';
import { hasDb, makeDealership, testPrisma } from '../test-db.js';
import { createTelegramContentJob, recordProviderCall } from './jobs.js';
import {
  canInvite,
  claimBootstrap,
  createTelegramInvite,
  effectiveRole,
  findTelegramAccount,
  redeemTelegramInvite,
} from './telegram.js';
import { localDay, startOfLocalDay, startOfLocalMonth } from './time.js';

let nextTgId = BigInt(Date.now()) * 1000n;
const identity = () => {
  const id = nextTgId++;
  return { telegramUserId: id, chatId: id, username: `u${id}`, firstName: 'Test' };
};

describe('time zone calendar helpers', () => {
  it('computes local midnight across time zones and DST', () => {
    // 2026-03-29 01:30 UTC is 03:30 in Madrid (after the DST jump).
    const t = new Date('2026-03-29T01:30:00Z');
    expect(startOfLocalDay(t, 'Europe/Madrid').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-09-25T02:00:00Z'), 'America/Sao_Paulo').toISOString()).toBe('2026-09-24T03:00:00.000Z');
    expect(startOfLocalMonth(new Date('2026-10-01T02:00:00Z'), 'America/Mexico_City').toISOString()).toBe('2026-09-01T06:00:00.000Z');
    expect(localDay(new Date('2026-09-25T02:00:00Z'), 'America/Sao_Paulo').toISOString()).toBe('2026-09-24T00:00:00.000Z');
  });

  it('falls back to UTC for an invalid zone', () => {
    expect(startOfLocalDay(new Date('2026-09-25T15:00:00Z'), 'Not/AZone').toISOString()).toBe('2026-09-25T00:00:00.000Z');
  });
});

describe('invite permissions', () => {
  it('never allows creating an OWNER, and ADMINs only invite below themselves', () => {
    expect(canInvite('OWNER', 'ADMIN')).toBe(true);
    expect(canInvite('OWNER', 'OWNER')).toBe(false);
    expect(canInvite('ADMIN', 'ADMIN')).toBe(false);
    expect(canInvite('ADMIN', 'OPERATOR')).toBe(true);
    expect(canInvite('EDITOR', 'OPERATOR')).toBe(false);
  });
});

describe.skipIf(!hasDb)('Telegram access and job creation (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let snapshot: (dealershipId: string) => Promise<SettingsSnapshot>;

  beforeAll(async () => {
    prisma = testPrisma();
    await seed(prisma);
    const settings = new SettingsService(prisma, 0);
    snapshot = async (id) => buildSettingsSnapshot(await settings.get(id));
  });
  afterAll(() => prisma.$disconnect());

  it('bootstrap: wrong code is rejected; the right code makes the first user OWNER exactly once', async () => {
    // Fresh demo owner state for this test.
    const demo = await prisma.dealership.findUniqueOrThrow({ where: { slug: 'demo' } });
    await prisma.telegramAccount.deleteMany({ where: { dealershipId: demo.id } });

    expect((await claimBootstrap(prisma, { code: 'wrong-code-123', expectedCode: 'right-code-123', identity: identity() })).status).toBe('invalid');
    expect((await claimBootstrap(prisma, { code: 'x', expectedCode: undefined, identity: identity() })).status).toBe('invalid');

    const first = identity();
    const r = await claimBootstrap(prisma, { code: 'right-code-123', expectedCode: 'right-code-123', identity: first });
    expect(r).toMatchObject({ status: 'linked', role: 'OWNER', dealershipId: demo.id });

    // Same person again → already linked; anyone else → already claimed.
    expect((await claimBootstrap(prisma, { code: 'right-code-123', expectedCode: 'right-code-123', identity: first })).status).toBe('already_linked');
    expect((await claimBootstrap(prisma, { code: 'right-code-123', expectedCode: 'right-code-123', identity: identity() })).status).toBe('already_claimed');

    const account = await findTelegramAccount(prisma, first.telegramUserId);
    expect(account && effectiveRole(account)).toBe('OWNER');
    expect(await prisma.auditLog.count({ where: { dealershipId: demo.id, action: 'telegram.bootstrap_claimed' } })).toBeGreaterThan(0);
  });

  it('bootstrap claims race safely: only one of many parallel claims wins', async () => {
    const demo = await prisma.dealership.findUniqueOrThrow({ where: { slug: 'demo' } });
    await prisma.telegramAccount.deleteMany({ where: { dealershipId: demo.id } });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => claimBootstrap(prisma, { code: 'c0de-c0de-c0de', expectedCode: 'c0de-c0de-c0de', identity: identity() })),
    );
    expect(results.filter((r) => r.status === 'linked')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'already_claimed')).toHaveLength(5);
  });

  it('invites: single use, expiring, role-limited, and bound to their dealership', async () => {
    const d = await makeDealership(prisma);
    const owner = await prisma.telegramAccount.create({ data: { dealershipId: d.id, ...identity(), role: 'OWNER' } });

    expect(await createTelegramInvite(prisma, { dealershipId: d.id, inviterRole: 'EDITOR', inviterAccountId: owner.id, role: 'OPERATOR' })).toEqual({
      error: 'forbidden',
    });

    const inv = await createTelegramInvite(prisma, { dealershipId: d.id, inviterRole: 'OWNER', inviterAccountId: owner.id, role: 'EDITOR' });
    if ('error' in inv) throw new Error('expected an invite');
    expect(inv.code).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(await prisma.telegramInvite.count({ where: { codeHash: inv.code } })).toBe(0); // only the hash is stored

    const joiner = identity();
    expect(await redeemTelegramInvite(prisma, { code: inv.code, identity: joiner })).toMatchObject({ status: 'linked', role: 'EDITOR', dealershipId: d.id });
    expect((await redeemTelegramInvite(prisma, { code: inv.code, identity: identity() })).status).toBe('invalid'); // used up

    const expired = await createTelegramInvite(prisma, {
      dealershipId: d.id,
      inviterRole: 'OWNER',
      inviterAccountId: owner.id,
      role: 'OPERATOR',
      now: new Date(Date.now() - 100 * 3600_000),
    });
    if ('error' in expired) throw new Error('expected an invite');
    expect((await redeemTelegramInvite(prisma, { code: expired.code, identity: identity() })).status).toBe('invalid');

    // Parallel redemptions of a 2-use invite: exactly two succeed.
    const two = await createTelegramInvite(prisma, { dealershipId: d.id, inviterRole: 'OWNER', inviterAccountId: owner.id, role: 'OPERATOR', maxUses: 2 });
    if ('error' in two) throw new Error('expected an invite');
    const results = await Promise.all(Array.from({ length: 5 }, () => redeemTelegramInvite(prisma, { code: two.code, identity: identity() })));
    expect(results.filter((r) => r.status === 'linked')).toHaveLength(2);

    await prisma.dealership.delete({ where: { id: d.id } });
  });

  it('creates a job once per Telegram message and enforces the daily limit under concurrency', async () => {
    const d = await makeDealership(prisma);
    await prisma.dealershipSettings.create({ data: { dealershipId: d.id, dailyJobLimit: 3, timezone: 'America/Sao_Paulo' } });
    const acct = await prisma.telegramAccount.create({ data: { dealershipId: d.id, ...identity() } });
    const snap = await snapshot(d.id);
    const base = { dealershipId: d.id, telegramAccountId: acct.id, telegramFileId: 'f', telegramChatId: 1n, snapshot: snap };

    const first = await createTelegramContentJob(prisma, { ...base, idempotencyKey: `k-${randomUUID()}`, telegramMessageId: 1 });
    expect(first.status).toBe('created');
    const key = `k-${randomUUID()}`;
    expect((await createTelegramContentJob(prisma, { ...base, idempotencyKey: key, telegramMessageId: 2 })).status).toBe('created');
    expect((await createTelegramContentJob(prisma, { ...base, idempotencyKey: key, telegramMessageId: 2 })).status).toBe('duplicate');

    // 1 slot left; 5 photos at once → exactly one more job.
    const burst = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createTelegramContentJob(prisma, { ...base, idempotencyKey: `k-${randomUUID()}`, telegramMessageId: 10 + i })),
    );
    expect(burst.filter((r) => r.status === 'created')).toHaveLength(1);
    expect(burst.filter((r) => r.status === 'limit_reached')).toHaveLength(4);
    expect(await prisma.contentJob.count({ where: { dealershipId: d.id } })).toBe(3);

    const usage = await prisma.usage.findMany({ where: { dealershipId: d.id, metric: 'JOBS_CREATED' } });
    expect(usage.reduce((s, u) => s + u.quantity, 0n)).toBe(3n);
    expect((await prisma.telegramAccount.findUniqueOrThrow({ where: { id: acct.id } })).activeContentJobId).not.toBeNull();

    await prisma.dealership.delete({ where: { id: d.id } });
  });

  it('records a provider call once: a replayed step never charges twice', async () => {
    const d = await makeDealership(prisma);
    await prisma.dealershipSettings.create({ data: { dealershipId: d.id } });
    const acct = await prisma.telegramAccount.create({ data: { dealershipId: d.id, ...identity() } });
    const snap = await snapshot(d.id);
    const job = await createTelegramContentJob(prisma, {
      dealershipId: d.id,
      telegramAccountId: acct.id,
      idempotencyKey: `k-${randomUUID()}`,
      telegramFileId: 'f',
      telegramChatId: 1n,
      telegramMessageId: 1,
      snapshot: snap,
    });
    if (job.status !== 'created') throw new Error('expected a job');

    const call = {
      dealershipId: d.id,
      contentJobId: job.jobId,
      adapter: 'vision-x',
      operation: 'VISION_ANALYZE' as const,
      status: 'SUCCESS' as const,
      attempt: 1,
      latencyMs: 900,
      costMicros: 2500n,
      idempotencyKey: `${job.jobId}:vision:1`,
      usageMetric: 'VISION_CALLS' as const,
      timezone: 'UTC',
    };
    expect((await prisma.$transaction((tx) => recordProviderCall(tx, call))).created).toBe(true);
    expect((await prisma.$transaction((tx) => recordProviderCall(tx, call))).created).toBe(false);

    const j = await prisma.contentJob.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(j.actualCostMicros).toBe(2500n);
    const u = await prisma.usage.findFirstOrThrow({ where: { dealershipId: d.id, metric: 'VISION_CALLS' } });
    expect(u.quantity).toBe(1n);
    expect(u.costMicros).toBe(2500n);

    // A failed attempt is logged for observability but never charged.
    await prisma.$transaction((tx) => recordProviderCall(tx, { ...call, status: 'ERROR', attempt: 2, idempotencyKey: `${job.jobId}:vision:2` }));
    expect((await prisma.contentJob.findUniqueOrThrow({ where: { id: job.jobId } })).actualCostMicros).toBe(2500n);
    expect(await prisma.generationLog.count({ where: { contentJobId: job.jobId } })).toBe(2);

    await prisma.dealership.delete({ where: { id: d.id } });
  });
});
