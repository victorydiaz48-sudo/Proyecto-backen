import { deterministicJobId } from '@autocontent/shared';
import { Prisma, type PrismaClient } from '../generated/client.js';
import type { UsageMetric } from '../generated/enums.js';
import type { SettingsSnapshot } from '../settings.js';
import { localDay, startOfLocalDay, startOfLocalMonth } from './time.js';

export type CreateJobResult =
  | { status: 'created'; jobId: string; vehicleId: string }
  | { status: 'duplicate'; jobId: string; jobStatus: string }
  | { status: 'limit_reached'; limit: 'daily_jobs' | 'monthly_vehicles' };

export async function incrementUsage(
  tx: Prisma.TransactionClient,
  opts: {
    dealershipId: string;
    day: Date;
    metric: UsageMetric;
    providerAdapter?: string;
    quantity?: bigint;
    costMicros?: bigint;
  },
) {
  const where = {
    dealershipId_day_metric_providerAdapter: {
      dealershipId: opts.dealershipId,
      day: opts.day,
      metric: opts.metric,
      providerAdapter: opts.providerAdapter ?? '',
    },
  };
  await tx.usage.upsert({
    where,
    create: { ...where.dealershipId_day_metric_providerAdapter, quantity: opts.quantity ?? 1n, costMicros: opts.costMicros ?? 0n },
    update: { quantity: { increment: opts.quantity ?? 1n }, costMicros: { increment: opts.costMicros ?? 0n } },
  });
}

/**
 * Creates the Vehicle(DRAFT) + ContentJob for one Telegram photo.
 *
 *  - idempotent: the same idempotencyKey returns the existing job
 *  - limits: daily jobs and monthly vehicles are checked in the dealership's
 *    time zone, under a per-dealership advisory lock so parallel photos can't
 *    both slip under the limit
 *  - counts JOBS_CREATED usage and marks the job as the sender's active job
 */
export async function createTelegramContentJob(
  prisma: PrismaClient,
  opts: {
    dealershipId: string;
    telegramAccountId: string;
    idempotencyKey: string;
    telegramFileId: string;
    telegramChatId: bigint;
    telegramMessageId: number;
    snapshot: SettingsSnapshot;
    now?: Date;
  },
): Promise<CreateJobResult> {
  const now = opts.now ?? new Date();
  const tz = opts.snapshot.timezone;
  const jobId = deterministicJobId(opts.idempotencyKey);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${opts.dealershipId}, 0))`;

    const existing = await tx.contentJob.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return { status: 'duplicate', jobId: existing.id, jobStatus: existing.status };

    const { dailyJobLimit, monthlyVehicleLimit } = opts.snapshot.limits;
    if (dailyJobLimit !== null) {
      const today = await tx.contentJob.count({
        where: { dealershipId: opts.dealershipId, createdAt: { gte: startOfLocalDay(now, tz) } },
      });
      if (today >= dailyJobLimit) return { status: 'limit_reached', limit: 'daily_jobs' };
    }
    if (monthlyVehicleLimit !== null) {
      const month = await tx.vehicle.count({
        where: { dealershipId: opts.dealershipId, createdAt: { gte: startOfLocalMonth(now, tz) } },
      });
      if (month >= monthlyVehicleLimit) return { status: 'limit_reached', limit: 'monthly_vehicles' };
    }

    const vehicle = await tx.vehicle.create({
      data: { dealershipId: opts.dealershipId, provenance: {}, visualFeatures: [] },
    });
    await tx.contentJob.create({
      data: {
        id: jobId,
        dealershipId: opts.dealershipId,
        vehicleId: vehicle.id,
        idempotencyKey: opts.idempotencyKey,
        source: 'TELEGRAM',
        telegramAccountId: opts.telegramAccountId,
        telegramChatId: opts.telegramChatId,
        telegramFileId: opts.telegramFileId,
        telegramMessageId: opts.telegramMessageId,
        requestedFormats: ['instagram_caption'],
        templateSlug: opts.snapshot.templateSlug,
        settingsSnapshot: opts.snapshot as unknown as Prisma.InputJsonObject,
      },
    });
    await tx.telegramAccount.update({
      where: { id: opts.telegramAccountId },
      data: { activeContentJobId: jobId, lastSeenAt: now },
    });
    await incrementUsage(tx, { dealershipId: opts.dealershipId, day: localDay(now, tz), metric: 'JOBS_CREATED' });
    return { status: 'created', jobId, vehicleId: vehicle.id };
  });
}

/**
 * Jobs that were accepted but never finished (e.g. the in-memory queue lost
 * them in a restart). Re-enqueued at startup; queue dedupe and idempotent
 * steps make this safe. Platform-level: spans all dealerships.
 */
export async function findUnfinishedJobs(prisma: PrismaClient, opts: { olderThanMs?: number; limit?: number } = {}) {
  return prisma.contentJob.findMany({
    where: {
      status: { in: ['PENDING', 'PROCESSING', 'RETRYING'] },
      createdAt: { lt: new Date(Date.now() - (opts.olderThanMs ?? 0)) },
    },
    select: { id: true, dealershipId: true },
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 500,
  });
}

export interface ProviderCallRecord {
  dealershipId: string;
  contentJobId: string;
  providerId?: string | null;
  adapter: string;
  operation: 'VISION_ANALYZE' | 'TEXT_GENERATE' | 'IMAGE_GENERATE' | 'VIDEO_GENERATE' | 'QA_REVIEW' | 'PUBLISH';
  model?: string;
  promptTemplate?: string;
  promptVersion?: string;
  status: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'RATE_LIMITED';
  errorCode?: string;
  errorMessage?: string;
  attempt: number;
  latencyMs: number;
  units?: number;
  unitType?: string;
  costMicros: bigint;
  outputSummary?: Prisma.InputJsonValue;
  /** "{jobId}:{step}:{attempt}" */
  idempotencyKey: string;
  usageMetric?: UsageMetric;
  timezone: string;
  now?: Date;
}

/**
 * Logs one provider call and — only for a successful call logged for the
 * first time — charges usage and job cost. Re-running the same step attempt
 * (a stalled job, a crash after the call) never double-charges.
 * Returns the GenerationLog id and whether this call was newly recorded.
 */
export async function recordProviderCall(
  tx: Prisma.TransactionClient,
  r: ProviderCallRecord,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.generationLog.findUnique({ where: { idempotencyKey: r.idempotencyKey }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };

  const log = await tx.generationLog.create({
    data: {
      dealershipId: r.dealershipId,
      contentJobId: r.contentJobId,
      providerId: r.providerId ?? null,
      adapter: r.adapter,
      operation: r.operation,
      model: r.model,
      promptTemplate: r.promptTemplate,
      promptVersion: r.promptVersion,
      status: r.status,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage?.slice(0, 500),
      attempt: r.attempt,
      latencyMs: r.latencyMs,
      units: r.units,
      unitType: r.unitType,
      costMicros: r.costMicros,
      outputSummary: r.outputSummary,
      idempotencyKey: r.idempotencyKey,
    },
    select: { id: true },
  });

  if (r.status === 'SUCCESS') {
    const now = r.now ?? new Date();
    if (r.usageMetric) {
      await incrementUsage(tx, {
        dealershipId: r.dealershipId,
        day: localDay(now, r.timezone),
        metric: r.usageMetric,
        providerAdapter: r.adapter,
        costMicros: r.costMicros,
      });
    }
    if (r.costMicros > 0n) {
      await tx.contentJob.update({
        where: { id: r.contentJobId },
        data: { actualCostMicros: { increment: r.costMicros } },
      });
    }
  }
  return { id: log.id, created: true };
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
