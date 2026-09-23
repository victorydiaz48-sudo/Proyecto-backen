import { z } from 'zod';
import { PgErrorCode, pgErrorCode, type Db } from '../../db.ts';
import { conflict, validationError } from '../../lib/errors.ts';
import { hashPassword, passwordProblem } from '../../lib/password.ts';
import { zCountryCode, zCurrency, zEmail, zLocale, zSlug, zTimeZone } from '../../lib/validation.ts';
import { writeAudit } from '../audit/audit.ts';

export const ProvisionTenantInput = z
  .object({
    slug: zSlug,
    name: z.string().trim().min(1).max(80),
    timezone: zTimeZone,
    defaultCountryCode: zCountryCode,
    currency: zCurrency,
    locale: zLocale,
    locationName: z.string().trim().min(1).max(40).default('Principal'),
    adminEmail: zEmail,
    adminPassword: z.string(),
  })
  .strict();
export type ProvisionTenantInput = z.input<typeof ProvisionTenantInput>;

/**
 * Alta de un tenant por el operador de la plataforma (CLI, docs/BACKEND_PLAN.md §4.1): crea el tenant,
 * su local por defecto y su primer ADMIN en una sola transacción.
 */
export async function provisionTenant(db: Db, raw: ProvisionTenantInput) {
  const parsed = ProvisionTenantInput.safeParse(raw);
  if (!parsed.success) {
    throw validationError(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const input = parsed.data;
  const problem = passwordProblem(input.adminPassword, input.adminEmail);
  if (problem) throw validationError([{ path: 'adminPassword', message: problem }]);
  if (await db.tenant.findUnique({ where: { slug: input.slug } })) throw conflict('Ya existe un negocio con ese slug.');

  const passwordHash = await hashPassword(input.adminPassword);
  try {
    return await createAll(db, input, passwordHash);
  } catch (err) {
    // Dos altas simultáneas con el mismo slug: la segunda choca con el índice único.
    if (pgErrorCode(err) === PgErrorCode.UNIQUE_VIOLATION) throw conflict('Ya existe un negocio con ese slug.');
    throw err;
  }
}

function createAll(db: Db, input: z.output<typeof ProvisionTenantInput>, passwordHash: string) {
  return db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug: input.slug,
        name: input.name,
        timezone: input.timezone,
        defaultCountryCode: input.defaultCountryCode,
        currency: input.currency,
        locale: input.locale,
      },
    });
    const location = await tx.location.create({ data: { tenantId: tenant.id, name: input.locationName, isDefault: true } });
    const admin = await tx.user.create({
      data: { tenantId: tenant.id, email: input.adminEmail, passwordHash, role: 'ADMIN' },
    });
    await writeAudit(tx, {
      tenantId: tenant.id,
      actorType: 'SYSTEM',
      action: 'tenant.provisioned',
      entityType: 'Tenant',
      entityId: tenant.id,
      after: { slug: tenant.slug, adminEmail: admin.email, locationId: location.id },
    });
    return { tenant, location, admin: { id: admin.id, email: admin.email } };
  });
}
