import type { PrismaClient } from './generated/client.js';

/**
 * Models whose rows belong to an organization (have a `organizationId` column).
 * Keep in sync with schema.prisma — tenant.test.ts fails if a model is missing.
 */
export const TENANT_MODELS = [
  'OrganizationSettings',
  'VerticalEnrollment',
  'Subscription',
  'User',
  'Session',
  'TelegramAccount',
  'TelegramInvite',
  'Vehicle',
  'VehicleImage',
  'ContentJob',
  'ContentAsset',
  'VideoPlan',
  'Campaign',
  'APIProvider',
  'APIKeyReference',
  'PublishingAccount',
  'Publication',
  'GenerationLog',
  'Usage',
  'AuditLog',
] as const;

const TENANT_SET = new Set<string>(TENANT_MODELS);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TenantViolationError extends Error {
  override readonly name = 'TenantViolationError';
}

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown; create?: unknown };

function stampData(model: string, data: unknown, organizationId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => stampData(model, d, organizationId));
  if (!data || typeof data !== 'object') return data;
  const row = data as Record<string, unknown>;
  if ('organization' in row) {
    throw new TenantViolationError(`${model}: use organizationId, not a "organization" relation, in tenant-scoped writes`);
  }
  if (row.organizationId !== undefined && row.organizationId !== organizationId) {
    throw new TenantViolationError(`${model}: attempted to write a row for another organization`);
  }
  return { ...row, organizationId };
}

/**
 * A client that can only see and write rows of one organization.
 *
 *  - every read/update/delete on a tenant model gets `organizationId` added to `where`
 *  - creates must pass `organizationId: db.$organizationId` (keeps Prisma's types
 *    exact); a create for any other organization throws TenantViolationError
 *  - Organization itself is readable/updatable only for this organization, never
 *    creatable/deletable
 *
 * Nested writes into other tenant models must set organizationId themselves; the
 * database's composite (id, organizationId) foreign keys reject any cross-tenant
 * link even if code gets that wrong. Raw SQL ($queryRaw) is not scoped: avoid it
 * in tenant code.
 */
export function forOrganization(prisma: PrismaClient, organizationId: string) {
  if (!UUID.test(organizationId)) throw new TenantViolationError(`Invalid organizationId "${organizationId}"`);

  return prisma.$extends({
    name: 'tenant-scope',
    client: { $organizationId: organizationId },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = { ...(args as Args) };

          if (model === 'Organization') {
            if (!['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'update'].includes(operation)) {
              throw new TenantViolationError(`Organization.${operation} is not allowed on a tenant-scoped client`);
            }
            a.where = { ...a.where, id: organizationId };
            return query(a);
          }
          if (!TENANT_SET.has(model)) return query(a);

          if (WHERE_OPS.has(operation)) a.where = { ...a.where, organizationId };
          if (CREATE_OPS.has(operation)) {
            if (operation === 'upsert') a.create = stampData(model, a.create, organizationId);
            else a.data = stampData(model, a.data, organizationId);
          }
          if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn' || operation === 'upsert') {
            const data = (operation === 'upsert' ? a.update : a.data) as Record<string, unknown> | undefined;
            if (data && 'organizationId' in data && data.organizationId !== organizationId) {
              throw new TenantViolationError(`${model}: rows cannot be moved to another organization`);
            }
          }
          return query(a);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forOrganization>;
