import type { CostConfig } from '@autocontent/shared';
import { costConfigSchema } from '@autocontent/shared';
import type { Prisma, PrismaClient } from './client.js';
import type { ProviderKind } from './generated/enums.js';
import { PLANS } from './plans.js';

export const DEMO_ORGANIZATION_SLUG = 'demo';

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
 * Idempotent: safe to run on every deploy. Creates the demo organization, its
 * settings and trial subscription, and the platform provider catalogue.
 */
export async function seed(prisma: PrismaClient, now = new Date()) {
  const organization = await prisma.organization.upsert({
    where: { slug: DEMO_ORGANIZATION_SLUG },
    update: {},
    create: { slug: DEMO_ORGANIZATION_SLUG, name: 'Concesionario Demo' },
  });

  await prisma.organizationSettings.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: { organizationId: organization.id, locale: 'es', publishingMode: 'DRAFT_ONLY' },
  });

  const plan = PLANS.trial!;
  await prisma.subscription.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: {
      organizationId: organization.id,
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
    const existing = await prisma.aPIProvider.findFirst({ where: { organizationId: null, adapter: p.adapter } });
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

  return { organizationId: organization.id };
}
