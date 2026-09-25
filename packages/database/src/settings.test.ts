import { afterAll, describe, expect, it } from 'vitest';
import type { DealershipSettings } from './generated/client.js';
import { seed, DEMO_DEALERSHIP_SLUG } from './seed.js';
import {
  SettingsService,
  buildSettingsSnapshot,
  effectiveLimits,
  resolveLocale,
  settingsSnapshotSchema,
  stricterPublishingMode,
} from './settings.js';
import { hasDb, makeDealership, testPrisma } from './test-db.js';

const settings = (over: Partial<DealershipSettings> = {}): DealershipSettings => ({
  dealershipId: '00000000-0000-4000-8000-000000000001',
  locale: 'pt',
  timezone: 'America/Sao_Paulo',
  currency: 'BRL',
  publishingMode: 'DRAFT_ONLY',
  defaultTemplateSlug: 'premium-dealership',
  defaultVideoStyle: null,
  brandName: null,
  contactPhone: '+55 11 99999-0000',
  contactWhatsapp: null,
  contactEmail: null,
  website: null,
  addressLine: null,
  city: 'São Paulo',
  defaultHashtags: ['#carros'],
  videoEnabled: true,
  monthlyCostCapMicros: 10_000_000n,
  dailyJobLimit: null,
  confirmCostAboveMicros: 0n,
  updatedById: null,
  updatedAt: new Date(),
  ...over,
});

const sub = { dailyJobLimit: 50, monthlyVehicleLimit: 200, monthlyVideoLimit: 20, monthlyCostCapMicros: 25_000_000n };

describe('effectiveLimits', () => {
  it('lets the dealership tighten but never loosen plan limits', () => {
    expect(effectiveLimits(settings({ dailyJobLimit: 10 }), sub)).toMatchObject({ dailyJobLimit: 10, monthlyCostCapMicros: 10_000_000n });
    expect(effectiveLimits(settings({ dailyJobLimit: 999, monthlyCostCapMicros: 99_000_000n }), sub)).toMatchObject({
      dailyJobLimit: 50,
      monthlyCostCapMicros: 25_000_000n,
    });
    expect(effectiveLimits(settings({ monthlyCostCapMicros: null }), null).monthlyCostCapMicros).toBeNull();
  });
});

describe('resolveLocale / stricterPublishingMode', () => {
  it('follows Telegram override → dealership → default', () => {
    expect(resolveLocale({ telegramOverride: 'en', dealershipLocale: 'pt', fallback: 'es' })).toBe('en');
    expect(resolveLocale({ telegramOverride: null, dealershipLocale: 'pt', fallback: 'es' })).toBe('pt');
    expect(resolveLocale({ fallback: 'es' })).toBe('es');
  });

  it('always picks the stricter publishing mode', () => {
    expect(stricterPublishingMode('AUTO_PUBLISH', 'DRAFT_ONLY')).toBe('DRAFT_ONLY');
    expect(stricterPublishingMode('SCHEDULED', 'AUTO_PUBLISH')).toBe('SCHEDULED');
  });
});

describe('buildSettingsSnapshot', () => {
  it('freezes settings into a JSON-safe, validated snapshot', () => {
    const snap = buildSettingsSnapshot(
      { dealership: { id: 'd', name: 'Autos Silva', status: 'ACTIVE' }, settings: settings(), subscription: { ...sub } as never },
      new Date('2026-09-25T12:00:00Z'),
    );
    expect(snap.brand.name).toBe('Autos Silva');
    expect(snap.limits.monthlyCostCapMicros).toBe('10000000');
    expect(snap.locale).toBe('pt');
    const roundTrip = settingsSnapshotSchema.parse(JSON.parse(JSON.stringify(snap)));
    expect(roundTrip).toEqual(snap);
  });
});

describe.skipIf(!hasDb)('seed + SettingsService (real PostgreSQL)', () => {
  const prisma = hasDb ? testPrisma() : undefined;
  afterAll(() => prisma?.$disconnect());

  it('seed is idempotent and creates a usable demo dealership', async () => {
    const a = await seed(prisma!);
    const b = await seed(prisma!);
    expect(a.dealershipId).toBe(b.dealershipId);
    expect(await prisma!.dealership.count({ where: { slug: DEMO_DEALERSHIP_SLUG } })).toBe(1);
    expect(await prisma!.aPIProvider.count({ where: { dealershipId: null, adapter: 'mock-vision' } })).toBe(1);
    const ctx = await new SettingsService(prisma!).get(a.dealershipId);
    expect(ctx.settings.locale).toBe('es');
    expect(ctx.settings.publishingMode).toBe('DRAFT_ONLY');
    expect(ctx.subscription?.planCode).toBe('trial');
  });

  it('caches for the TTL, creates default settings lazily, and invalidates', async () => {
    const d = await makeDealership(prisma!);
    let now = 0;
    const svc = new SettingsService(prisma!, 1000, () => now);
    expect((await svc.get(d.id)).settings.locale).toBe('es'); // created lazily
    await prisma!.dealershipSettings.update({ where: { dealershipId: d.id }, data: { locale: 'pt' } });
    expect((await svc.get(d.id)).settings.locale).toBe('es'); // cached
    svc.invalidate(d.id);
    expect((await svc.get(d.id)).settings.locale).toBe('pt');
    now = 5000;
    await prisma!.dealershipSettings.update({ where: { dealershipId: d.id }, data: { locale: 'en' } });
    expect((await svc.get(d.id)).settings.locale).toBe('en'); // TTL expired
    await prisma!.dealership.delete({ where: { id: d.id } });
  });
});
