import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from './client.js';
import { forDealership, TenantViolationError, type TenantDb } from './tenant.js';
import { hasDb, makeDealership, testPrisma } from './test-db.js';

const emptyVehicle = { provenance: {}, visualFeatures: [] };

describe.skipIf(!hasDb)('tenant isolation (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let A: string;
  let B: string;
  let tA: TenantDb;
  let tB: TenantDb;
  let vehicleA: string;
  let vehicleB: string;

  beforeAll(async () => {
    prisma = testPrisma();
    A = (await makeDealership(prisma, 'A')).id;
    B = (await makeDealership(prisma, 'B')).id;
    tA = forDealership(prisma, A);
    tB = forDealership(prisma, B);
    vehicleA = (await tA.vehicle.create({ data: { ...emptyVehicle, dealershipId: tA.$dealershipId, make: 'Toyota' } })).id;
    vehicleB = (await tB.vehicle.create({ data: { ...emptyVehicle, dealershipId: tB.$dealershipId, make: 'BMW' } })).id;
  });

  afterAll(async () => {
    await prisma.dealership.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.$disconnect();
  });

  it('stamps dealershipId on create', async () => {
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleA } });
    expect(v.dealershipId).toBe(A);
  });

  it('cannot read another dealership’s rows', async () => {
    expect(await tB.vehicle.findUnique({ where: { id: vehicleA } })).toBeNull();
    expect((await tB.vehicle.findMany()).map((v) => v.id)).toEqual([vehicleB]);
    expect(await tB.vehicle.count({ where: { make: 'Toyota' } })).toBe(0);
  });

  it('cannot update or delete another dealership’s rows', async () => {
    await expect(tB.vehicle.update({ where: { id: vehicleA }, data: { make: 'Hacked' } })).rejects.toThrow();
    const res = await tB.vehicle.deleteMany({ where: { id: vehicleA } });
    expect(res.count).toBe(0);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleA } })).make).toBe('Toyota');
  });

  it('refuses to create rows for, or move rows to, another dealership', async () => {
    await expect(tA.vehicle.create({ data: { ...emptyVehicle, dealershipId: B } })).rejects.toBeInstanceOf(
      TenantViolationError,
    );
    await expect(tA.vehicle.update({ where: { id: vehicleA }, data: { dealershipId: B } })).rejects.toBeInstanceOf(
      TenantViolationError,
    );
  });

  it('scopes the Dealership model itself', async () => {
    expect((await tA.dealership.findMany()).map((d) => d.id)).toEqual([A]);
    await expect(tA.dealership.create({ data: { name: 'x', slug: randomUUID() } })).rejects.toBeInstanceOf(
      TenantViolationError,
    );
    await expect(tA.dealership.deleteMany()).rejects.toBeInstanceOf(TenantViolationError);
  });

  it('the database itself rejects cross-tenant links, even from the raw client', async () => {
    // Job in dealership A pointing at dealership B's vehicle.
    await expect(
      prisma.contentJob.create({
        data: {
          id: randomUUID(),
          dealershipId: A,
          vehicleId: vehicleB,
          idempotencyKey: randomUUID(),
          source: 'TELEGRAM',
          settingsSnapshot: {},
        },
      }),
    ).rejects.toThrow(/tenant_ContentJob_vehicle|foreign key/i);
    await expect(
      prisma.vehicleImage.create({
        data: {
          dealershipId: A,
          vehicleId: vehicleB,
          storageKey: randomUUID(),
          mime: 'image/png',
          width: 1,
          height: 1,
          bytes: 1,
          sha256: 'a'.repeat(64),
        },
      }),
    ).rejects.toThrow(/tenant_VehicleImage_vehicle|foreign key/i);
  });

  it('ON DELETE SET NULL (col) clears only the link, keeping the tenant id', async () => {
    const job = await tA.contentJob.create({
      data: { id: randomUUID(), dealershipId: A, vehicleId: vehicleA, idempotencyKey: randomUUID(), source: 'TELEGRAM', settingsSnapshot: {} },
    });
    const acct = await tA.telegramAccount.create({
      data: { dealershipId: A, telegramUserId: BigInt(Date.now()), chatId: 1n, activeContentJobId: job.id },
    });
    await tA.contentJob.delete({ where: { id: job.id } });
    const after = await prisma.telegramAccount.findUniqueOrThrow({ where: { id: acct.id } });
    expect(after.activeContentJobId).toBeNull();
    expect(after.dealershipId).toBe(A);
  });

  it('idempotency keys make retried steps unable to duplicate work or charges', async () => {
    const job = await tA.contentJob.create({
      data: { id: randomUUID(), dealershipId: A, vehicleId: vehicleA, idempotencyKey: randomUUID(), source: 'TELEGRAM', settingsSnapshot: {} },
    });
    const log = {
      adapter: 'mock-vision',
      operation: 'VISION_ANALYZE' as const,
      status: 'SUCCESS' as const,
      attempt: 1,
      latencyMs: 10,
      idempotencyKey: `${job.id}:vision:1`,
      contentJobId: job.id,
      dealershipId: A,
    };
    await tA.generationLog.create({ data: log });
    await expect(tA.generationLog.create({ data: log })).rejects.toThrow(/Unique constraint|unique/i);

    const asset = { dealershipId: A, contentJobId: job.id, vehicleId: vehicleA, kind: 'TEXT' as const, format: 'instagram_caption', channel: 'INSTAGRAM' as const, locale: 'es' as const };
    await tA.contentAsset.create({ data: asset });
    await expect(tA.contentAsset.create({ data: asset })).rejects.toThrow(/Unique constraint|unique/i);
    await expect(tA.contentAsset.create({ data: { ...asset, version: 2 } })).resolves.toBeTruthy();
  });

  it('Usage counters are unique per dealership/day/metric/provider and never negative', async () => {
    const day = new Date('2026-09-25T00:00:00Z');
    const key = { day, metric: 'VISION_CALLS' as const, providerAdapter: 'mock-vision' };
    await tA.usage.upsert({
      where: { dealershipId_day_metric_providerAdapter: { dealershipId: A, ...key } },
      create: { ...key, dealershipId: A, quantity: 1n },
      update: { quantity: { increment: 1n } },
    });
    await tA.usage.upsert({
      where: { dealershipId_day_metric_providerAdapter: { dealershipId: A, ...key } },
      create: { ...key, dealershipId: A, quantity: 1n },
      update: { quantity: { increment: 1n } },
    });
    expect((await tA.usage.findMany({ where: { metric: 'VISION_CALLS' } }))[0]!.quantity).toBe(2n);
    await expect(tA.usage.updateMany({ where: key, data: { quantity: -1n } })).rejects.toThrow(/tenant_Usage_non_negative|check/i);
  });

  it('a publishing account can only use its own dealership’s API key', async () => {
    const provider = await prisma.aPIProvider.create({
      data: { adapter: `blotato-test-${randomUUID()}`, kind: 'SOCIAL_PUBLISHING', displayName: 'Blotato', config: {}, costConfig: [] },
    });
    const keyB = await tB.aPIKeyReference.create({
      data: { dealershipId: B, providerId: provider.id, label: 'B key', source: 'ENV', envVarName: 'BLOTATO_API_KEY' },
    });
    await expect(
      tA.publishingAccount.create({
        data: { dealershipId: A, providerId: provider.id, apiKeyRefId: keyB.id, platform: 'INSTAGRAM', externalAccountId: 'x', displayName: 'x' },
      }),
    ).rejects.toThrow(/tenant_PublishingAccount_apiKeyRef|foreign key/i);
    await expect(
      tA.aPIKeyReference.create({ data: { dealershipId: A, providerId: provider.id, label: 'bad', source: 'DATABASE' } }),
    ).rejects.toThrow(/tenant_APIKeyReference_source_check|check/i);
    await prisma.aPIProvider.delete({ where: { id: provider.id } });
  });
});
