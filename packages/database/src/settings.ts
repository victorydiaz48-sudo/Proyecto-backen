import { LOCALES, type Locale } from '@autocontent/shared';
import { z } from 'zod';
import type { Organization, OrganizationSettings, PrismaClient, Subscription } from './generated/client.js';
import type { PublishingMode } from './generated/enums.js';

/**
 * Organization settings: where they live and how they reach a job.
 *
 *  OrganizationSettings (typed row)  ─┐
 *  Subscription (plan limits)       ├─► buildSettingsSnapshot() ─► ContentJob.settingsSnapshot
 *  Organization (name)               ─┘                                  │
 *                                                            workers read only the snapshot
 *
 * The snapshot keeps retries deterministic even if settings change mid-job.
 * Exception: publishing re-reads live settings and applies the stricter mode.
 */

const PUBLISHING_MODES = ['DRAFT_ONLY', 'SCHEDULED', 'AUTO_PUBLISH'] as const;
/** Bigints are stored as decimal strings: JSON has no bigint. */
const micros = z.string().regex(/^\d+$/);

export const settingsSnapshotSchema = z.object({
  version: z.literal(1),
  takenAt: z.iso.datetime(),
  locale: z.enum(LOCALES),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  publishingMode: z.enum(PUBLISHING_MODES),
  templateSlug: z.string().min(1),
  videoStyle: z.string().nullable(),
  videoEnabled: z.boolean(),
  brand: z.object({
    name: z.string().min(1),
    phone: z.string().nullable(),
    whatsapp: z.string().nullable(),
    email: z.string().nullable(),
    website: z.string().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
  }),
  hashtags: z.array(z.string()),
  limits: z.object({
    dailyJobLimit: z.number().int().nullable(),
    monthlyVehicleLimit: z.number().int().nullable(),
    monthlyVideoLimit: z.number().int().nullable(),
    monthlyCostCapMicros: micros.nullable(),
  }),
  confirmCostAboveMicros: micros,
});
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

export interface EffectiveLimits {
  dailyJobLimit: number | null;
  monthlyVehicleLimit: number | null;
  monthlyVideoLimit: number | null;
  monthlyCostCapMicros: bigint | null;
}

/** Lower of two optional limits; null means "no limit". */
function minLimit<T extends number | bigint>(a: T | null | undefined, b: T | null | undefined): T | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return a < b ? a : b;
}

/** Plan limits can only be tightened by the organization, never loosened. */
export function effectiveLimits(
  settings: Pick<OrganizationSettings, 'dailyJobLimit' | 'monthlyCostCapMicros'>,
  subscription: Pick<
    Subscription,
    'dailyJobLimit' | 'monthlyVehicleLimit' | 'monthlyVideoLimit' | 'monthlyCostCapMicros'
  > | null,
): EffectiveLimits {
  return {
    dailyJobLimit: minLimit(settings.dailyJobLimit, subscription?.dailyJobLimit),
    monthlyVehicleLimit: subscription?.monthlyVehicleLimit ?? null,
    monthlyVideoLimit: subscription?.monthlyVideoLimit ?? null,
    monthlyCostCapMicros: minLimit(settings.monthlyCostCapMicros, subscription?.monthlyCostCapMicros),
  };
}

/** Language precedence: Telegram user override → organization → platform default. */
export function resolveLocale(opts: {
  telegramOverride?: Locale | null;
  organizationLocale?: Locale | null;
  fallback: Locale;
}): Locale {
  return opts.telegramOverride ?? opts.organizationLocale ?? opts.fallback;
}

const STRICTNESS: Record<PublishingMode, number> = { DRAFT_ONLY: 0, SCHEDULED: 1, AUTO_PUBLISH: 2 };

/** At publish time: the stricter of the snapshot and the live setting wins. */
export function stricterPublishingMode(a: PublishingMode, b: PublishingMode): PublishingMode {
  return STRICTNESS[a] <= STRICTNESS[b] ? a : b;
}

export interface OrganizationContext {
  organization: Pick<Organization, 'id' | 'name' | 'status'>;
  settings: OrganizationSettings;
  subscription: Subscription | null;
}

export function buildSettingsSnapshot(ctx: OrganizationContext, now = new Date()): SettingsSnapshot {
  const s = ctx.settings;
  const limits = effectiveLimits(s, ctx.subscription);
  return settingsSnapshotSchema.parse({
    version: 1,
    takenAt: now.toISOString(),
    locale: s.locale,
    timezone: s.timezone,
    currency: s.currency,
    publishingMode: s.publishingMode,
    templateSlug: s.defaultTemplateSlug,
    videoStyle: s.defaultVideoStyle,
    videoEnabled: s.videoEnabled,
    brand: {
      name: s.brandName ?? ctx.organization.name,
      phone: s.contactPhone,
      whatsapp: s.contactWhatsapp,
      email: s.contactEmail,
      website: s.website,
      address: s.addressLine,
      city: s.city,
    },
    hashtags: s.defaultHashtags,
    limits: {
      dailyJobLimit: limits.dailyJobLimit,
      monthlyVehicleLimit: limits.monthlyVehicleLimit,
      monthlyVideoLimit: limits.monthlyVideoLimit,
      monthlyCostCapMicros: limits.monthlyCostCapMicros?.toString() ?? null,
    },
    confirmCostAboveMicros: s.confirmCostAboveMicros.toString(),
  });
}

/**
 * Loads an organization's settings with a short in-process cache. Call
 * invalidate() after editing settings (the API does; Phase 2 also broadcasts
 * the invalidation to other processes).
 */
export class SettingsService {
  private readonly cache = new Map<string, { at: number; value: OrganizationContext }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(organizationId: string): Promise<OrganizationContext> {
    const hit = this.cache.get(organizationId);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;

    const d = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true, status: true, settings: true, subscription: true },
    });
    // Every organization gets a settings row; create defaults lazily if missing.
    const settings = d.settings ?? (await this.prisma.organizationSettings.create({ data: { organizationId } }));
    const value: OrganizationContext = {
      organization: { id: d.id, name: d.name, status: d.status },
      settings,
      subscription: d.subscription,
    };
    this.cache.set(organizationId, { at: this.now(), value });
    return value;
  }

  invalidate(organizationId: string): void {
    this.cache.delete(organizationId);
  }
}
