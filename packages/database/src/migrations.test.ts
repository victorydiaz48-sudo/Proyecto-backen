import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TENANT_MODELS } from './tenant.js';
import { hasDb, testPrisma } from './test-db.js';

const root = join(import.meta.dirname, '..', 'prisma');
const migrationsDir = join(root, 'migrations');
const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const sql = (name: string) => readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');

/** Hand-written constraints that Prisma cannot express (and would try to drop). */
export const TENANT_CONSTRAINTS = [
  'tenant_Session_user',
  'tenant_TelegramAccount_user',
  'tenant_TelegramAccount_activeJob',
  'tenant_Vehicle_primaryImage',
  'tenant_VehicleImage_vehicle',
  'tenant_ContentJob_telegramAccount',
  'tenant_ContentJob_campaign',
  'tenant_ContentAsset_contentJob',
  'tenant_ContentAsset_generationLog',
  'tenant_VideoPlan_contentJob',
  'tenant_VideoPlan_videoAsset',
  'tenant_PublishingAccount_apiKeyRef',
  'tenant_Publication_contentJob',
  'tenant_Publication_publishingAccount',
  'tenant_Publication_primaryAsset',
  'tenant_GenerationLog_contentJob',
  'tenant_APIKeyReference_source_check',
  'tenant_Usage_non_negative',
  'tenant_ContentJob_costs_non_negative',
  'tenant_ContentAsset_version_positive',
  'tenant_TelegramInvite_uses',
];
const TENANT_INDEXES = ['tenant_APIProvider_platform_adapter', 'tenant_APIProvider_organization_adapter'];
/** Hand-written objects without the tenant_ prefix (target of a composite foreign key). */
const OTHER_HAND_WRITTEN = ['APIKeyReference_id_organizationId_key'];
/**
 * The one sanctioned exception to "never drop a tenant_* constraint": these
 * guarded `vehicleId` on ContentJob/ContentAsset/VideoPlan, which Phase 3c
 * drops in favour of the polymorphic subjectType/subjectId (no FK, by
 * design — see docs/phase-3-design.md §3.2) now that every write path goes
 * through it. Dropped explicitly, by name, in
 * `..._drop_vehicle_id_complete_subject_reference`.
 */
const RETIRED_TENANT_CONSTRAINTS = ['tenant_ContentJob_vehicle', 'tenant_ContentAsset_vehicle', 'tenant_VideoPlan_vehicle'];

describe('migrations', () => {
  it('create every tenant-boundary constraint', () => {
    const all = migrations.map(sql).join('\n');
    for (const name of [...TENANT_CONSTRAINTS, ...TENANT_INDEXES, ...RETIRED_TENANT_CONSTRAINTS]) expect(all).toContain(`"${name}"`);
  });

  it('never drops a tenant-boundary constraint except the documented vehicleId retirement (Phase 3c)', () => {
    for (const m of migrations) {
      const drops = [...sql(m).matchAll(/DROP\s+(?:CONSTRAINT|INDEX)\s+(?:IF EXISTS\s+)?"(tenant_[^"]+)"/gi)].map((x) => x[1]);
      for (const name of drops) {
        expect(RETIRED_TENANT_CONSTRAINTS, `migration ${m} drops ${name}`).toContain(name);
      }
      for (const name of OTHER_HAND_WRITTEN) {
        expect(sql(m), `migration ${m} drops ${name}`).not.toMatch(new RegExp(`DROP\\s+(CONSTRAINT|INDEX)\\s+(IF EXISTS\\s+)?"${name}"`, 'i'));
      }
    }
  });

  it('TENANT_MODELS lists every model with a organizationId column', () => {
    // Scans the core schema plus every vertical module's own schema fragment
    // (its source, not the synced copy — this test doesn't depend on
    // sync-verticals having run) so a module-owned tenant table is covered too.
    const verticalsDir = join(root, '..', '..', 'verticals');
    const verticalSchemas = readdirSync(verticalsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(verticalsDir, d.name, 'prisma', 'schema.prisma'))
      .filter((p) => existsSync(p));
    const schema = [join(root, 'schema.prisma'), ...verticalSchemas].map((p) => readFileSync(p, 'utf8')).join('\n');
    const withTenant = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+organizationId\s/m.test(body!))
      .map(([, name]) => name);
    expect([...TENANT_MODELS].sort()).toEqual(withTenant.sort());
  });
});

describe.skipIf(!hasDb)('migrated database', () => {
  const prisma = hasDb ? testPrisma() : undefined;
  afterAll(() => prisma?.$disconnect());

  it('has every tenant-boundary constraint and index in place', async () => {
    const rows = await prisma!.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint WHERE conname LIKE 'tenant\\_%'
      UNION SELECT indexname AS name FROM pg_indexes WHERE indexname LIKE 'tenant\\_%'`;
    expect(rows.map((r) => r.name).sort()).toEqual([...TENANT_CONSTRAINTS, ...TENANT_INDEXES].sort());
  });
});
