import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from './client.js';

/**
 * Database tests run against TEST_DATABASE_URL (migrated beforehand). Locally
 * they are skipped when it is unset; CI sets REQUIRE_DB_TESTS=1 so a missing
 * database fails the build instead of silently skipping.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL && process.env.REQUIRE_DB_TESTS === '1') {
  throw new Error('REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set');
}

export const hasDb = Boolean(TEST_DATABASE_URL);

export function testPrisma(): PrismaClient {
  return createPrismaClient(TEST_DATABASE_URL!, { maxConnections: 4 });
}

export async function makeOrganization(prisma: PrismaClient, name = 'Test') {
  return prisma.organization.create({ data: { name, slug: `test-${randomUUID()}` } });
}
