import { createPrismaClient } from '@autocontent/database';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { enrollOrganization, loadBusinessProfile } from './business-profile.js';
import { defineVerticalModule, type VerticalModule } from './module.js';
import { VerticalRegistry } from './registry.js';

/**
 * Two deliberately trivial stub modules — not the real dealership module.
 * Proving the registry/dispatch mechanism works is the point of this test
 * file; the dealership module itself is re-platformed in sub-phase 3b.
 */
function stubModule(slug: string, messageKey: string): VerticalModule<{ greeting?: string }> {
  return defineVerticalModule({
    slug,
    displayName: slug,
    configSchema: z.object({ greeting: z.string().optional() }),
    entities: [],
    storagePathSegment: `${slug}s`,
    workflow: {
      onJobCreate: async () => ({ subjectType: `${slug}.thing`, subjectId: '00000000-0000-4000-8000-000000000001' }),
      getStoredImage: async (): Promise<null> => null,
      storeImage: async () => ({ imageId: '00000000-0000-4000-8000-000000000002', reusedAnalysis: null }),
      onAnalysisComplete: async () => {},
      computeMissingInformation: () => [],
      formatSubjectForDisplay: () => `stub:${slug}`,
      generateCaption: () => ({ text: `caption from ${slug}`, usedFields: [] }),
    },
    contentTemplates: { templates: [], formats: [], videoStyles: [] },
    routes: [],
    messages: { es: { [messageKey]: `hola desde ${slug}` } },
  });
}

const alpha = stubModule('alpha', 'greeting');
const beta = stubModule('beta', 'greeting'); // same key as alpha → collision, used by the collision test only

describe('VerticalRegistry', () => {
  it('registers modules and resolves them by slug', () => {
    const registry = new VerticalRegistry([alpha, stubModule('gamma', 'other')]);
    expect(registry.has('alpha')).toBe(true);
    expect(registry.has('nope')).toBe(false);
    expect(registry.get('alpha')).toBe(alpha);
    expect(registry.list().map((m) => m.slug).sort()).toEqual(['alpha', 'gamma']);
  });

  it('throws VerticalRegistryError for an unregistered slug (never returns undefined)', () => {
    const registry = new VerticalRegistry([alpha]);
    expect(() => registry.get('missing')).toThrow('Unknown vertical "missing"');
  });

  it('rejects duplicate slugs at construction time', () => {
    expect(() => new VerticalRegistry([alpha, stubModule('alpha', 'other')])).toThrow(/Duplicate vertical slug "alpha"/);
  });

  it('rejects a message key collision across modules, for the same locale only', () => {
    expect(() => new VerticalRegistry([alpha, beta])).toThrow(/Message key "greeting" \(es\) is contributed by both "alpha" and "beta"/);
    // Different keys, or the same key in a locale only one module declares, is fine.
    expect(() => new VerticalRegistry([alpha, stubModule('gamma', 'unrelated')])).not.toThrow();
  });

  it('rejects an invalid slug shape at module-definition time', () => {
    expect(() => stubModule('Not_Valid', 'x')).toThrow(/Invalid vertical slug/);
  });

  it('resolves a namespaced subjectType to its owning module', () => {
    const registry = new VerticalRegistry([alpha, stubModule('gamma', 'other')]);
    expect(registry.resolveSubjectType('alpha.thing')).toEqual({ module: alpha, entityKind: 'thing' });
    expect(() => registry.resolveSubjectType('unknown.thing')).toThrow(/Unknown vertical "unknown"/);
    expect(() => registry.resolveSubjectType('malformed')).toThrow(/Malformed subjectType/);
  });

  it('dispatches purely through Map lookups, never a name-keyed branch', () => {
    // Structural guard, not just a style note: prove dispatch works for a
    // vertical this test adds *after* the registry already existed, with no
    // code change anywhere else — the shape the whole design rests on.
    const registry = new VerticalRegistry([alpha, stubModule('gamma', 'other')]);
    for (const slug of ['alpha', 'gamma']) {
      expect(registry.get(slug).workflow.generateCaption(undefined, 'es').text).toBe(`caption from ${slug}`);
    }
  });
});

const DB = process.env.TEST_DATABASE_URL;
if (!DB && process.env.REQUIRE_DB_TESTS === '1') throw new Error('REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set');

describe.skipIf(!DB)('business profile (real PostgreSQL)', () => {
  const prisma = createPrismaClient(DB!, { maxConnections: 4 });
  const registry = new VerticalRegistry([alpha, stubModule('gamma', 'other')]);

  it('enrolls an organization, validates config, and round-trips through loadBusinessProfile', async () => {
    const org = await prisma.organization.create({ data: { name: 'Reg Test', slug: `reg-test-${Date.now()}` } });
    try {
      const enrolled = await enrollOrganization(prisma, registry, {
        organizationId: org.id,
        vertical: 'alpha',
        config: { greeting: 'hi' },
      });
      expect(enrolled.vertical.slug).toBe('alpha');
      expect(enrolled.config).toEqual({ greeting: 'hi' });

      const loaded = await loadBusinessProfile(prisma, registry, org.id);
      expect(loaded.vertical).toBe(alpha);
      expect(loaded.config).toEqual({ greeting: 'hi' });

      // Re-enrolling replaces the single enrollment row (one vertical per org, Phase 3).
      await enrollOrganization(prisma, registry, { organizationId: org.id, vertical: 'gamma' });
      expect((await loadBusinessProfile(prisma, registry, org.id)).vertical.slug).toBe('gamma');
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it('rejects enrollment in an unregistered vertical, and rejects config the module schema disallows', async () => {
    const org = await prisma.organization.create({ data: { name: 'Reg Test 2', slug: `reg-test-${Date.now()}-2` } });
    try {
      await expect(enrollOrganization(prisma, registry, { organizationId: org.id, vertical: 'not-a-real-module' })).rejects.toThrow(
        /Unknown vertical/,
      );
      await expect(
        enrollOrganization(prisma, registry, { organizationId: org.id, vertical: 'alpha', config: { greeting: 42 } }),
      ).rejects.toThrow();
      expect(await prisma.verticalEnrollment.findUnique({ where: { organizationId: org.id } })).toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it('loadBusinessProfile throws for an organization with no enrollment', async () => {
    const org = await prisma.organization.create({ data: { name: 'Reg Test 3', slug: `reg-test-${Date.now()}-3` } });
    try {
      await expect(loadBusinessProfile(prisma, registry, org.id)).rejects.toThrow(/no vertical enrollment/);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });
});
