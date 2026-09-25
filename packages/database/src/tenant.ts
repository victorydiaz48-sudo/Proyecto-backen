import type { PrismaClient } from './generated/client.js';

/**
 * Models whose rows belong to a dealership (have a `dealershipId` column).
 * Keep in sync with schema.prisma — tenant.test.ts fails if a model is missing.
 */
export const TENANT_MODELS = [
  'DealershipSettings',
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

function stampData(model: string, data: unknown, dealershipId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => stampData(model, d, dealershipId));
  if (!data || typeof data !== 'object') return data;
  const row = data as Record<string, unknown>;
  if ('dealership' in row) {
    throw new TenantViolationError(`${model}: use dealershipId, not a "dealership" relation, in tenant-scoped writes`);
  }
  if (row.dealershipId !== undefined && row.dealershipId !== dealershipId) {
    throw new TenantViolationError(`${model}: attempted to write a row for another dealership`);
  }
  return { ...row, dealershipId };
}

/**
 * A client that can only see and write rows of one dealership.
 *
 *  - every read/update/delete on a tenant model gets `dealershipId` added to `where`
 *  - creates must pass `dealershipId: db.$dealershipId` (keeps Prisma's types
 *    exact); a create for any other dealership throws TenantViolationError
 *  - Dealership itself is readable/updatable only for this dealership, never
 *    creatable/deletable
 *
 * Nested writes into other tenant models must set dealershipId themselves; the
 * database's composite (id, dealershipId) foreign keys reject any cross-tenant
 * link even if code gets that wrong. Raw SQL ($queryRaw) is not scoped: avoid it
 * in tenant code.
 */
export function forDealership(prisma: PrismaClient, dealershipId: string) {
  if (!UUID.test(dealershipId)) throw new TenantViolationError(`Invalid dealershipId "${dealershipId}"`);

  return prisma.$extends({
    name: 'tenant-scope',
    client: { $dealershipId: dealershipId },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = { ...(args as Args) };

          if (model === 'Dealership') {
            if (!['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'update'].includes(operation)) {
              throw new TenantViolationError(`Dealership.${operation} is not allowed on a tenant-scoped client`);
            }
            a.where = { ...a.where, id: dealershipId };
            return query(a);
          }
          if (!TENANT_SET.has(model)) return query(a);

          if (WHERE_OPS.has(operation)) a.where = { ...a.where, dealershipId };
          if (CREATE_OPS.has(operation)) {
            if (operation === 'upsert') a.create = stampData(model, a.create, dealershipId);
            else a.data = stampData(model, a.data, dealershipId);
          }
          if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn' || operation === 'upsert') {
            const data = (operation === 'upsert' ? a.update : a.data) as Record<string, unknown> | undefined;
            if (data && 'dealershipId' in data && data.dealershipId !== dealershipId) {
              throw new TenantViolationError(`${model}: rows cannot be moved to another dealership`);
            }
          }
          return query(a);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forDealership>;
