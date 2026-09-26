import { createHash } from 'node:crypto';
import type { Prisma } from '@autocontent/database';
import type { JobSubjectRef, SubjectImage, WorkflowHooks } from '@autocontent/verticals-core';
import type { Locale } from '@autocontent/shared';
import { formatSubjectForDisplay } from './format.js';
import { barbershopMessages } from './i18n.js';
import { HAIRSTYLES, computeMissingInformation, haircutAnalysisSchema, type HaircutAnalysis, type Hairstyle } from './entities/haircut-analysis.js';

export const SUBJECT_TYPE = 'barbershop.haircut';

/**
 * Deterministic mock "analyzer": no vendor call, same photo → same style
 * (hash of the bytes), so a demo is repeatable — mirrors the shape of
 * dealership's MockVisionProvider without needing a whole VisionProvider
 * abstraction (WorkflowHooks doesn't require one; a vertical is free to get
 * its analysis however it wants).
 */
export function mockAnalyzeHaircut(bytes: Uint8Array, provider = 'mock-haircut'): HaircutAnalysis {
  const digest = createHash('sha256').update(bytes).digest();
  const style: Hairstyle = HAIRSTYLES[digest.readUInt32BE(0) % (HAIRSTYLES.length - 1)]!; // never "other"
  const colors = ['black', 'brown', 'blonde', 'auburn'];
  const color = colors[digest.readUInt32BE(4) % colors.length]!;
  const base = {
    subject: 'haircut' as const,
    image_quality: [],
    style: { value: style, source: 'detected' as const, confidence: 0.9 },
    color: { value: color, source: 'detected' as const, confidence: 0.85 },
    confidence: 0.9,
    provider,
  };
  return haircutAnalysisSchema.parse({ ...base, missing_information: computeMissingInformation(base) });
}

function generateCaption(a: HaircutAnalysis, locale: Locale): { text: string; usedFields: string[] } {
  const bm = barbershopMessages(locale);
  const style = a.style.source !== 'unknown' ? bm.hairstyles[a.style.value!] : null;
  const used: string[] = [];
  if (style) used.push('style');
  const title = style ?? bm.labels.unidentified;
  const CTA: Record<Locale, string> = {
    es: '📩 Reserva tu turno por mensaje.',
    pt: '📩 Marque seu horário por mensagem.',
    en: '📩 Book your next cut by message.',
  };
  const text = [`💇 ${title}`, '', CTA[locale]].join('\n');
  return { text, usedFields: used };
}

export const barbershopWorkflow: WorkflowHooks<HaircutAnalysis> = {
  async onJobCreate({ organizationId, tx }): Promise<JobSubjectRef> {
    const haircut = await tx.haircut.create({ data: { organizationId, provenance: {} } });
    return { subjectType: SUBJECT_TYPE, subjectId: haircut.id };
  },

  async getStoredImage({ subject, organizationId, prisma }): Promise<SubjectImage<HaircutAnalysis> | null> {
    const photo = await prisma.haircutPhoto.findFirst({ where: { haircutId: subject.subjectId, organizationId }, orderBy: { createdAt: 'asc' } });
    if (!photo) return null;
    return {
      imageId: photo.id,
      storageKey: photo.storageKey,
      mime: photo.mime,
      width: photo.width,
      height: photo.height,
      sha256: photo.sha256,
      analysis: photo.analysis ? haircutAnalysisSchema.parse(photo.analysis) : null,
    };
  },

  async storeImage({ subject, organizationId, storageKey, mime, width, height, bytes, sha256, providerName, prisma }) {
    const photo = await prisma.haircutPhoto.upsert({
      where: { storageKey },
      create: { organizationId, haircutId: subject.subjectId, storageKey, mime, width, height, bytes, sha256 },
      update: {},
    });
    await prisma.haircut.update({ where: { id: subject.subjectId }, data: { primaryPhotoId: photo.id } });

    const prior = await prisma.haircutPhoto.findFirst({
      where: { organizationId, sha256, id: { not: photo.id }, analyzedAt: { not: null } },
      orderBy: { analyzedAt: 'desc' },
    });
    const priorAnalysis = prior?.analysis ? haircutAnalysisSchema.safeParse(prior.analysis) : null;
    const reusedAnalysis = priorAnalysis?.success && priorAnalysis.data.provider === providerName ? priorAnalysis.data : null;
    return { imageId: photo.id, reusedAnalysis };
  },

  async onAnalysisComplete({ subject, imageId, analysis, providerName, tx }) {
    await tx.haircutPhoto.update({
      where: { id: imageId },
      data: { analysis: analysis as unknown as Prisma.InputJsonObject, analyzedBy: providerName, analyzedAt: new Date() },
    });
    const haircut = await tx.haircut.findUniqueOrThrow({ where: { id: subject.subjectId }, select: { provenance: true } });
    const prov = (haircut.provenance ?? {}) as Record<string, { source: string } | undefined>;
    const userProvided = (k: string) => prov[k]?.source === 'user-provided';
    const nextProv: Record<string, unknown> = { ...prov };
    const data: Prisma.HaircutUpdateInput = {};
    if (!userProvided('style')) {
      data.style = analysis.style.value;
      nextProv.style = analysis.style.confidence === undefined ? { source: analysis.style.source } : { source: analysis.style.source, confidence: analysis.style.confidence };
    }
    if (!userProvided('color')) {
      data.color = analysis.color.value;
      nextProv.color = analysis.color.confidence === undefined ? { source: analysis.color.source } : { source: analysis.color.source, confidence: analysis.color.confidence };
    }
    data.provenance = nextProv as Prisma.InputJsonObject;
    await tx.haircut.update({ where: { id: subject.subjectId }, data });
  },

  isSubjectUsable(analysis: HaircutAnalysis) {
    if (analysis.subject === 'haircut') return { usable: true };
    return { usable: false, reasonKey: analysis.subject === 'not_haircut' ? 'notAHaircut' : 'unclearHaircutPhoto' };
  },

  describeUnusableReason(reasonKey: string, locale: Locale) {
    const bm = barbershopMessages(locale);
    return bm[reasonKey as 'notAHaircut' | 'unclearHaircutPhoto'];
  },

  computeMissingInformation(analysis: HaircutAnalysis) {
    return computeMissingInformation(analysis);
  },

  formatSubjectForDisplay,

  generateCaption,

  describeAnalysisForLog(analysis: HaircutAnalysis) {
    return { subject: analysis.subject, confidence: analysis.confidence, style: analysis.style.value };
  },
};
