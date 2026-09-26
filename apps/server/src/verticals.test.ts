import { createHash } from 'node:crypto';
import { createPrismaClient } from '@autocontent/database';
import { makePng } from '@autocontent/shared/testing';
import { barbershopModule, mockAnalyzeHaircut } from '@autocontent/verticals-barbershop';
import { enrollOrganization, loadBusinessProfile, VerticalRegistry } from '@autocontent/verticals-core';
import { dealershipModule } from '@autocontent/verticals-dealership';
import { describe, expect, it } from 'vitest';

/**
 * Phase 3d: barbershop is scaffolded specifically to prove the registry,
 * WorkflowHooks and business-profile mechanisms are generic across more
 * than one real vertical — not just the stub modules in
 * packages/verticals/core/src/registry.test.ts.
 */
describe('a second real vertical (barbershop) alongside dealership', () => {
  it('registers both modules with no slug or i18n collisions', () => {
    const registry = new VerticalRegistry([dealershipModule, barbershopModule]);
    expect(registry.list().map((m) => m.slug).sort()).toEqual(['barbershop', 'dealership']);
    expect(registry.get('dealership')).toBe(dealershipModule);
    expect(registry.get('barbershop')).toBe(barbershopModule);
  });

  it('gives each module its own storage path segment and subjectType namespace', () => {
    expect(dealershipModule.storagePathSegment).not.toBe(barbershopModule.storagePathSegment);
    const registry = new VerticalRegistry([dealershipModule, barbershopModule]);
    expect(registry.resolveSubjectType('dealership.vehicle').module).toBe(dealershipModule);
    expect(registry.resolveSubjectType('barbershop.haircut').module).toBe(barbershopModule);
  });

  it('ships a valid, self-contained content template catalogue', () => {
    expect(barbershopModule.contentTemplates.templates.length).toBeGreaterThan(0);
    expect(barbershopModule.contentTemplates.formats.length).toBeGreaterThan(0);
    expect(barbershopModule.contentTemplates.videoStyles.length).toBeGreaterThan(0);
  });

  it('produces a schema-valid, fully tagged analysis and a caption with no core code involved', () => {
    const bytes = makePng(400, 400, 3);
    const analysis = mockAnalyzeHaircut(bytes);
    expect(analysis.subject).toBe('haircut');
    expect(analysis.style.source).toBe('detected');

    const caption = barbershopModule.workflow.generateCaption(analysis, 'es');
    expect(caption.text).toContain('💇');
    expect(barbershopModule.workflow.formatSubjectForDisplay(analysis, 'en', { mock: true })).toContain('Confidence');
  });

  it('is deterministic for the same photo, like dealership’s mock provider', () => {
    const bytes = makePng(500, 500, 11);
    expect(mockAnalyzeHaircut(bytes)).toEqual(mockAnalyzeHaircut(bytes));
    expect(mockAnalyzeHaircut(makePng(500, 500, 12))).not.toEqual(mockAnalyzeHaircut(bytes));
  });

  const DB = process.env.TEST_DATABASE_URL;
  if (!DB && process.env.REQUIRE_DB_TESTS === '1') throw new Error('REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set');

  describe.skipIf(!DB)('enrollment and WorkflowHooks against real PostgreSQL', () => {
    const prisma = createPrismaClient(DB!, { maxConnections: 4 });
    const registry = new VerticalRegistry([dealershipModule, barbershopModule]);

    it('enrolls an organization in barbershop (not dealership) and round-trips its profile', async () => {
      const org = await prisma.organization.create({ data: { name: 'Barbershop Test', slug: `barbershop-test-${Date.now()}` } });
      try {
        await enrollOrganization(prisma, registry, { organizationId: org.id, vertical: 'barbershop' });
        const profile = await loadBusinessProfile(prisma, registry, org.id);
        expect(profile.vertical).toBe(barbershopModule);
      } finally {
        await prisma.organization.delete({ where: { id: org.id } });
      }
    });

    it('runs onJobCreate/storeImage/onAnalysisComplete against the module’s own tables, exactly like dealership’s', async () => {
      const org = await prisma.organization.create({ data: { name: 'Barbershop Flow', slug: `barbershop-flow-${Date.now()}` } });
      try {
        const subject = await prisma.$transaction((tx) => barbershopModule.workflow.onJobCreate({ organizationId: org.id, tx }));
        expect(subject.subjectType).toBe('barbershop.haircut');

        const bytes = makePng(600, 600, 21);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const { imageId, reusedAnalysis } = await barbershopModule.workflow.storeImage({
          subject,
          organizationId: org.id,
          storageKey: `organizations/${org.id}/haircuts/${subject.subjectId}/originals/${sha256}.png`,
          mime: 'image/png',
          width: 600,
          height: 600,
          bytes: bytes.length,
          sha256,
          providerName: 'mock-haircut',
          prisma,
        });
        expect(reusedAnalysis).toBeNull();

        const analysis = mockAnalyzeHaircut(bytes);
        await prisma.$transaction((tx) => barbershopModule.workflow.onAnalysisComplete({ subject, imageId, analysis, providerName: 'mock-haircut', tx }));

        const haircut = await prisma.haircut.findUniqueOrThrow({ where: { id: subject.subjectId } });
        expect(haircut.style).toBe(analysis.style.value);
        expect(haircut.provenance).toHaveProperty('style');

        const stored = await barbershopModule.workflow.getStoredImage({ subject, organizationId: org.id, prisma });
        expect(stored?.analysis).toEqual(analysis);
      } finally {
        await prisma.organization.delete({ where: { id: org.id } });
      }
    });
  });
});
