import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export { PrismaClient, Prisma } from './generated/client.js';
export * from './generated/enums.js';

/**
 * The raw client. Only platform code (seed, migrations, provider catalogue,
 * cross-tenant admin jobs) may use it directly; everything that acts for a
 * dealership must go through forDealership().
 */
export function createPrismaClient(databaseUrl: string, opts: { maxConnections?: number } = {}) {
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: opts.maxConnections ?? 10 });
  return new PrismaClient({ adapter });
}
