import type { Prisma, PrismaClient } from '@autocontent/database';
import { VerticalRegistryError } from './errors.js';
import type { VerticalModule } from './module.js';
import type { VerticalRegistry } from './registry.js';

/**
 * An organization's vertical enrollment, resolved to a real module + its
 * parsed, validated config. This is the "BusinessProfile" from
 * docs/phase-3-design.md §5 — not a new table, a read model over
 * Organization + VerticalEnrollment.
 */
export interface BusinessProfile<TConfig = unknown> {
  organizationId: string;
  vertical: VerticalModule<TConfig>;
  config: TConfig;
}

/**
 * Loads and validates an organization's enrollment. Throws
 * VerticalRegistryError if the organization has no enrollment, or if it's
 * enrolled in a vertical this build doesn't have compiled in (should not
 * happen in practice: enrollOrganization() only writes registered slugs, but
 * a build that dropped a module afterwards would otherwise fail silently).
 *
 * No caching yet — this is the registry skeleton (Phase 3a). Wiring this
 * into the bot's hot path with the same TTL-cache approach as
 * SettingsService is Phase 3b's job, once there's a real second caller.
 */
export async function loadBusinessProfile(
  prisma: PrismaClient,
  registry: VerticalRegistry,
  organizationId: string,
): Promise<BusinessProfile> {
  const enrollment = await prisma.verticalEnrollment.findUnique({ where: { organizationId } });
  if (!enrollment) throw new VerticalRegistryError(`Organization ${organizationId} has no vertical enrollment`);
  const vertical = registry.get(enrollment.vertical);
  const config = vertical.configSchema.parse(enrollment.config);
  return { organizationId, vertical, config };
}

/**
 * Enrolls an organization in a vertical. Validates the slug against the
 * running registry and the config against that module's own schema before
 * writing — `VerticalEnrollment.vertical` is a plain string precisely so a
 * new module needs no core migration to become enrollable, which means this
 * function is the one place that stands in for a database CHECK constraint.
 * One enrollment per organization (Phase 3): re-enrolling replaces it.
 */
export async function enrollOrganization(
  prisma: PrismaClient,
  registry: VerticalRegistry,
  opts: { organizationId: string; vertical: string; config?: unknown },
): Promise<BusinessProfile> {
  const vertical = registry.get(opts.vertical); // throws for an unregistered slug
  const config = vertical.configSchema.parse(opts.config ?? {});
  // config was just parsed against the module's own zod schema; Prisma's Json
  // input type is stricter than `unknown` but the shape is already validated.
  const configJson = config as Prisma.InputJsonValue;
  await prisma.verticalEnrollment.upsert({
    where: { organizationId: opts.organizationId },
    create: { organizationId: opts.organizationId, vertical: opts.vertical, config: configJson },
    update: { vertical: opts.vertical, config: configJson },
  });
  return { organizationId: opts.organizationId, vertical, config };
}
