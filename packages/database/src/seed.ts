import { fileURLToPath } from 'node:url';
import type { CostConfig } from '@autocontent/shared';
import { costConfigSchema } from '@autocontent/shared';
import { createPrismaClient, type Prisma, type PrismaClient } from './client.js';
import type { ProviderKind } from './generated/enums.js';
import { PLANS } from './plans.js';

export const DEMO_DEALERSHIP_SLUG = 'demo';

interface CatalogueEntry {
  adapter: string;
  kind: ProviderKind;
  displayName: string;
  isDefault: boolean;
  config: Prisma.InputJsonObject;
  costConfig: CostConfig;
}

/**
 * Platform provider catalogue. Mock adapters cost nothing; real adapters are
 * added (with their real prices) in the phases that implement them.
 */
export const PROVIDER_CATALOGUE: CatalogueEntry[] = [
  { adapter: 'telegram', kind: 'TELEGRAM', displayName: 'Telegram Bot API', isDefault: true, config: {}, costConfig: [] },
  {
    adapter: 'mock-vision',
    kind: 'VISION',
    displayName: 'Mock vision (MOCK_MODE)',
    isDefault: true,
    config: {},
    costConfig: [{ unitType: 'image', costMicros: 0 }],
  },
];

/**
 * Idempotent: safe to run on every deploy. Creates the demo dealership, its
 * settings and trial subscription, and the platform provider catalogue.
 */
export async function seed(prisma: PrismaClient, now = new Date()) {
  const dealership = await prisma.dealership.upsert({
    where: { slug: DEMO_DEALERSHIP_SLUG },
    update: {},
    create: { slug: DEMO_DEALERSHIP_SLUG, name: 'Concesionario Demo' },
  });

  await prisma.dealershipSettings.upsert({
    where: { dealershipId: dealership.id },
    update: {},
    create: { dealershipId: dealership.id, locale: 'es', publishingMode: 'DRAFT_ONLY' },
  });

  const plan = PLANS.trial!;
  await prisma.subscription.upsert({
    where: { dealershipId: dealership.id },
    update: {},
    create: {
      dealershipId: dealership.id,
      planCode: plan.code,
      status: 'TRIALING',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + plan.periodDays * 86_400_000),
      dailyJobLimit: plan.dailyJobLimit,
      monthlyVehicleLimit: plan.monthlyVehicleLimit,
      monthlyVideoLimit: plan.monthlyVideoLimit,
      monthlyCostCapMicros: plan.monthlyCostCapMicros,
    },
  });

  for (const p of PROVIDER_CATALOGUE) {
    const costConfig = costConfigSchema.parse(p.costConfig);
    // Platform rows are unique by a partial index Prisma can't target with upsert.
    const existing = await prisma.aPIProvider.findFirst({ where: { dealershipId: null, adapter: p.adapter } });
    if (existing) {
      await prisma.aPIProvider.update({
        where: { id: existing.id },
        data: { kind: p.kind, displayName: p.displayName, isDefault: p.isDefault },
      });
    } else {
      await prisma.aPIProvider.create({
        data: { adapter: p.adapter, kind: p.kind, displayName: p.displayName, isDefault: p.isDefault, config: p.config, costConfig },
      });
    }
  }

  return { dealershipId: dealership.id };
}

// CLI entry: `pnpm --filter @autocontent/database seed`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const prisma = createPrismaClient(url);
  seed(prisma)
    .then((r) => console.log(JSON.stringify({ level: 'info', msg: 'seed complete', ...r })))
    .catch((err: unknown) => {
      console.error(JSON.stringify({ level: 'error', msg: 'seed failed', err: String(err) }));
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
