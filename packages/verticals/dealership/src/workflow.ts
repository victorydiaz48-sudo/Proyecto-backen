import type { Prisma } from '@autocontent/database';
import type { JobSubjectRef, SubjectImage, WorkflowHooks } from '@autocontent/verticals-core';
import type { Locale } from '@autocontent/shared';
import { generateCaption } from './content-engine/caption.js';
import { computeMissingInformation, vehicleAnalysisSchema, type VehicleAnalysis } from './entities/vehicle-analysis.js';
import { formatSubjectForDisplay } from './format.js';
import { dealershipMessages } from './i18n.js';

export const SUBJECT_TYPE = 'dealership.vehicle';

const toDbEnum = (v: string) => v.toUpperCase().replace(/-/g, '_');

/** Vehicle columns + provenance from an analysis. Never overwrites user-provided facts. */
function vehicleUpdateFromAnalysis(a: VehicleAnalysis, currentProvenance: unknown): Prisma.VehicleUpdateInput {
  const prov = (currentProvenance ?? {}) as Record<string, { source: string } | undefined>;
  const userProvided = (k: string) => prov[k]?.source === 'user-provided';
  const data: Prisma.VehicleUpdateInput = {};
  const nextProv: Record<string, unknown> = { ...prov };
  const set = <K extends 'make' | 'model' | 'version' | 'year' | 'color' | 'body_type' | 'estimated_segment'>(
    field: K,
    column: 'make' | 'model' | 'version' | 'year' | 'color' | 'bodyType' | 'segment',
    map: (v: NonNullable<VehicleAnalysis[K]['value']>) => unknown = (v) => v,
  ) => {
    if (userProvided(field)) return;
    const f = a[field];
    (data as Record<string, unknown>)[column] = f.value === null ? null : map(f.value as NonNullable<VehicleAnalysis[K]['value']>);
    nextProv[field] = f.confidence === undefined ? { source: f.source } : { source: f.source, confidence: f.confidence };
  };
  set('make', 'make');
  set('model', 'model');
  set('version', 'version');
  set('year', 'year');
  set('color', 'color');
  set('body_type', 'bodyType', (v) => toDbEnum(v) as Prisma.VehicleUpdateInput['bodyType']);
  set('estimated_segment', 'segment', (v) => toDbEnum(v) as Prisma.VehicleUpdateInput['segment']);
  data.provenance = nextProv as Prisma.InputJsonObject;
  data.visualFeatures = a.visual_features as unknown as Prisma.InputJsonArray;
  return data;
}

export const dealershipWorkflow: WorkflowHooks<VehicleAnalysis> = {
  async onJobCreate({ organizationId, tx }): Promise<JobSubjectRef> {
    const vehicle = await tx.vehicle.create({ data: { organizationId, provenance: {}, visualFeatures: [] } });
    return { subjectType: SUBJECT_TYPE, subjectId: vehicle.id };
  },

  async getStoredImage({ subject, organizationId, prisma }): Promise<SubjectImage<VehicleAnalysis> | null> {
    const image = await prisma.vehicleImage.findFirst({ where: { vehicleId: subject.subjectId, organizationId }, orderBy: { createdAt: 'asc' } });
    if (!image) return null;
    return {
      imageId: image.id,
      storageKey: image.storageKey,
      mime: image.mime,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
      analysis: image.analysis ? vehicleAnalysisSchema.parse(image.analysis) : null,
    };
  },

  async storeImage({ subject, organizationId, storageKey, mime, width, height, bytes, sha256, providerName, prisma }) {
    const image = await prisma.vehicleImage.upsert({
      where: { storageKey },
      create: { organizationId, vehicleId: subject.subjectId, storageKey, mime, width, height, bytes, sha256 },
      update: {},
    });
    await prisma.vehicle.update({ where: { id: subject.subjectId }, data: { primaryImageId: image.id } });

    const prior = await prisma.vehicleImage.findFirst({
      where: { organizationId, sha256, id: { not: image.id }, analyzedAt: { not: null } },
      orderBy: { analyzedAt: 'desc' },
    });
    const priorAnalysis = prior?.analysis ? vehicleAnalysisSchema.safeParse(prior.analysis) : null;
    const reusedAnalysis = priorAnalysis?.success && priorAnalysis.data.provider === providerName ? priorAnalysis.data : null;
    return { imageId: image.id, reusedAnalysis };
  },

  async onAnalysisComplete({ subject, imageId, analysis, providerName, tx }) {
    await tx.vehicleImage.update({
      where: { id: imageId },
      data: { analysis: analysis as unknown as Prisma.InputJsonObject, analyzedBy: providerName, analyzedAt: new Date() },
    });
    const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: subject.subjectId }, select: { provenance: true } });
    await tx.vehicle.update({ where: { id: subject.subjectId }, data: vehicleUpdateFromAnalysis(analysis, vehicle.provenance) });
  },

  isSubjectUsable(analysis: VehicleAnalysis) {
    if (analysis.subject === 'vehicle') return { usable: true };
    return { usable: false, reasonKey: analysis.subject === 'not_vehicle' ? 'notAVehicle' : analysis.subject === 'multiple_vehicles' ? 'multipleVehicles' : 'unclearPhoto' };
  },

  describeUnusableReason(reasonKey: string, locale: Locale) {
    const m = dealershipMessages(locale);
    return m[reasonKey as 'notAVehicle' | 'multipleVehicles' | 'unclearPhoto'];
  },

  computeMissingInformation(analysis: VehicleAnalysis) {
    return computeMissingInformation(analysis);
  },

  formatSubjectForDisplay(analysis: VehicleAnalysis, locale: Locale, opts: { mock: boolean }) {
    return formatSubjectForDisplay(analysis, locale, opts);
  },

  generateCaption(analysis: VehicleAnalysis, locale: Locale) {
    return generateCaption(analysis, locale);
  },

  describeAnalysisForLog(analysis: VehicleAnalysis) {
    return { subject: analysis.subject, confidence: analysis.confidence, make: analysis.make.value, model: analysis.model.value };
  },

  async markSubjectUnusable({ subject, prisma }) {
    await prisma.vehicle.update({ where: { id: subject.subjectId }, data: { status: 'ARCHIVED' } });
  },
};
