import { createHash } from 'node:crypto';
import {
  Prisma,
  forOrganization,
  localDay,
  incrementUsage,
  recordProviderCall,
  settingsSnapshotSchema,
  type PrismaClient,
  type SettingsSnapshot,
} from '@autocontent/database';
import {
  computeCostMicros,
  costConfigSchema,
  storageKey,
  type ChatNotifier,
  type StorageProvider,
  type TelegramFileFetcher,
  type VisionProvider,
} from '@autocontent/providers';
import type { FinalFailureHandler, JobContext, JobHandler } from '@autocontent/queue';
import type { JobSubjectRef, VerticalModule } from '@autocontent/verticals-core';
import {
  ImageValidationError,
  LogEvent,
  NonRetryableError,
  ProviderNotConfiguredError,
  escapeHtml,
  messages,
  validateImage,
  type ContentJobPayload,
  type ImageLimits,
  type Locale,
} from '@autocontent/shared';

export { CONTENT_JOBS_QUEUE, type ContentJobPayload } from '@autocontent/shared';
export const CAPTION_FORMAT = 'instagram_caption';

export interface WorkerDeps<TAnalysis = unknown> {
  prisma: PrismaClient;
  storage: StorageProvider;
  vision: VisionProvider<TAnalysis>;
  vertical: VerticalModule<unknown, TAnalysis>;
  notifier: ChatNotifier;
  files: TelegramFileFetcher;
  limits: ImageLimits;
  mockMode: boolean;
  visionTimeoutMs?: number;
  now?: () => Date;
}

const FINISHED = ['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED', 'FAILED'] as const;

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function failureText(err: unknown, locale: Locale, limits: ImageLimits): string {
  const m = messages(locale);
  if (err instanceof ImageValidationError) {
    switch (err.reason) {
      case 'too_large':
        return m.imageTooLarge(Math.floor(limits.maxBytes / (1024 * 1024)));
      case 'too_small':
        return m.imageTooSmall(limits.minDimension);
      case 'too_big_dimensions':
        return m.imageTooBigDimensions(limits.maxDimension);
      case 'unsupported_type':
        return m.unsupportedFile;
      case 'corrupt':
        return m.imageInvalid;
    }
  }
  if (err instanceof ProviderNotConfiguredError) return m.visionNotConfigured;
  return m.jobFailed;
}

/**
 * Processes one content job: ingest → analyse → caption → deliver → complete.
 *
 * Every step checks the database before acting, so a retried or stalled job
 * resumes where it stopped:
 *  - ingest: skipped if the subject already has its original image stored
 *    (`WorkflowHooks.getStoredImage`)
 *  - analysis: skipped if the image was analysed; an identical photo analysed
 *    before in the same organization is reused without calling (or paying) the
 *    provider again (`WorkflowHooks.storeImage`'s `reusedAnalysis`); provider
 *    calls are logged/charged once per attempt key
 *  - caption: one ContentAsset per (job, format, version)
 *  - delivery: analysisDeliveredAt / deliveredAt mark what was sent
 *    (at-least-once: a crash between sending and marking can repeat a message)
 *
 * This shell knows nothing about any particular vertical's own tables — every
 * step that used to touch `db.vehicle.*`/`db.vehicleImage.*` directly now
 * goes through `deps.vertical.workflow` (docs/phase-3-design.md §7.2, §14 3b).
 */
export function createContentJobProcessor<TAnalysis = unknown>(deps: WorkerDeps<TAnalysis>): {
  handler: JobHandler<ContentJobPayload>;
  onFinalFailure: FinalFailureHandler<ContentJobPayload>;
} {
  const now = deps.now ?? (() => new Date());
  const workflow = deps.vertical.workflow;

  const handler = async (p: ContentJobPayload, ctx: JobContext) => {
    const log = ctx.logger.child({ organizationId: p.organizationId });
    const db = forOrganization(deps.prisma, p.organizationId);
    const job = await db.contentJob.findUnique({ where: { id: p.contentJobId } });
    if (!job) {
      log.warn('content job not found (deleted?)');
      return;
    }
    if ((FINISHED as readonly string[]).includes(job.status)) return;
    const subject: JobSubjectRef = { subjectType: job.subjectType, subjectId: job.subjectId };

    const snap: SettingsSnapshot = settingsSnapshotSchema.parse(job.settingsSnapshot);
    const locale = snap.locale;
    const m = messages(locale);
    const chatId = job.telegramChatId === null ? null : Number(job.telegramChatId);

    await db.contentJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING', stage: 'INGEST', attempts: ctx.attempt, startedAt: job.startedAt ?? now() },
    });

    try {
      // ── 1. Ingest the original photo ────────────────────────────────────
      const stored = await workflow.getStoredImage({ subject, organizationId: p.organizationId, prisma: deps.prisma });
      let imageId: string;
      let storedKey: string;
      let mime: string;
      let width: number;
      let height: number;
      let sha256: string;
      let bytes: Uint8Array;
      let analysis: TAnalysis | null;

      if (stored) {
        imageId = stored.imageId;
        storedKey = stored.storageKey;
        mime = stored.mime;
        width = stored.width;
        height = stored.height;
        sha256 = stored.sha256;
        analysis = stored.analysis;
        bytes = await deps.storage.get(storedKey);
      } else {
        if (!job.telegramFileId) throw new NonRetryableError('Job has no source image');
        bytes = await deps.files.download(job.telegramFileId, deps.limits.maxBytes);
        const v = validateImage(bytes, deps.limits);
        sha256 = createHash('sha256').update(bytes).digest('hex');
        storedKey = storageKey(p.organizationId, deps.vertical.storagePathSegment, subject.subjectId, 'originals', `${sha256}.${EXT[v.mime]}`);
        await deps.storage.put(storedKey, bytes, { mime: v.mime, sha256 });
        mime = v.mime;
        width = v.width;
        height = v.height;
        const res = await workflow.storeImage({
          subject,
          organizationId: p.organizationId,
          storageKey: storedKey,
          mime: v.mime,
          width: v.width,
          height: v.height,
          bytes: v.bytes,
          sha256,
          providerName: deps.vision.name,
          prisma: deps.prisma,
        });
        imageId = res.imageId;
        analysis = res.reusedAnalysis;
        if (analysis) log.info('analysis reused from an identical photo; no provider call', { event: LogEvent.IMAGE_ANALYZED });
        log.info('image stored', { event: LogEvent.IMAGE_RECEIVED, mime: v.mime, width: v.width, height: v.height, bytes: v.bytes });
      }

      // ── 2. Analyse ──────────────────────────────────────────────────────
      await db.contentJob.update({ where: { id: job.id }, data: { stage: 'ANALYSIS' } });

      if (!analysis) {
        const t0 = Date.now();
        const attemptKey = `${job.id}:vision:${ctx.attempt}`;
        const provider = await deps.prisma.aPIProvider.findFirst({ where: { organizationId: null, adapter: deps.vision.name } });
        try {
          const res = await deps.vision.analyze(
            {
              images: [{ bytes, mime: mime as 'image/jpeg' | 'image/png' | 'image/webp', width, height, sha256 }],
              locale,
            },
            {
              jobId: job.id,
              organizationId: p.organizationId,
              idempotencyKey: attemptKey,
              signal: AbortSignal.timeout(deps.visionTimeoutMs ?? 60_000),
              logger: log,
            },
          );
          analysis = res.data;
          const cost = provider ? computeCostMicros(costConfigSchema.parse(provider.costConfig), res.usage) : { totalMicros: 0n, unpriced: res.usage };
          if (cost.unpriced.length > 0) log.warn('provider usage has no configured price', { adapter: deps.vision.name, unpriced: cost.unpriced });
          const units = res.usage.reduce((s, u) => s + u.units, 0);
          await deps.prisma.$transaction(async (tx) => {
            await recordProviderCall(tx, {
              organizationId: p.organizationId,
              contentJobId: job.id,
              providerId: provider?.id,
              adapter: deps.vision.name,
              operation: 'VISION_ANALYZE',
              model: res.model,
              status: 'SUCCESS',
              attempt: ctx.attempt,
              latencyMs: res.latencyMs,
              units,
              unitType: res.usage[0]?.unitType,
              costMicros: cost.totalMicros,
              outputSummary: (workflow.describeAnalysisForLog?.(res.data) ?? {}) as Prisma.InputJsonValue,
              idempotencyKey: attemptKey,
              usageMetric: 'VISION_CALLS',
              timezone: snap.timezone,
              now: now(),
            });
          });
          log.info('image analyzed', {
            event: LogEvent.IMAGE_ANALYZED,
            provider: deps.vision.name,
            model: res.model,
            durationMs: Date.now() - t0,
            costMicros: cost.totalMicros.toString(),
            ...workflow.describeAnalysisForLog?.(res.data),
          });
        } catch (err) {
          await deps.prisma
            .$transaction((tx) =>
              recordProviderCall(tx, {
                organizationId: p.organizationId,
                contentJobId: job.id,
                providerId: provider?.id,
                adapter: deps.vision.name,
                operation: 'VISION_ANALYZE',
                status: (err as Error)?.name === 'ProviderTimeoutError' || (err as Error)?.name === 'TimeoutError' ? 'TIMEOUT' : (err as Error)?.name === 'ProviderRateLimitError' ? 'RATE_LIMITED' : 'ERROR',
                errorCode: (err as Error)?.name,
                errorMessage: (err as Error)?.message,
                attempt: ctx.attempt,
                latencyMs: Date.now() - t0,
                costMicros: 0n,
                idempotencyKey: attemptKey,
                timezone: snap.timezone,
              }),
            )
            .catch((logErr: unknown) => log.warn('could not record failed provider call', { err: logErr }));
          throw err;
        }
      }

      // Always (re)applied: idempotent, never overwrites user-provided facts, and
      // repairs a subject left without identity if a previous attempt crashed
      // right after the analysis was saved.
      await deps.prisma.$transaction((tx) => workflow.onAnalysisComplete({ subject, imageId, analysis: analysis as TAnalysis, providerName: deps.vision.name, tx }));

      // Not a usable photo for this vertical: tell the user and stop before generating anything.
      const usable = workflow.isSubjectUsable?.(analysis) ?? { usable: true as const };
      if (!usable.usable) {
        if (!job.analysisDeliveredAt && chatId !== null) {
          const text = workflow.describeUnusableReason?.(usable.reasonKey, locale) ?? m.jobFailed;
          await deps.notifier.sendText(chatId, text);
          await db.contentJob.update({ where: { id: job.id }, data: { analysisDeliveredAt: now() } });
        }
        await workflow.markSubjectUnusable?.({ subject, prisma: deps.prisma });
        await complete(job.id);
        return;
      }

      // ── 3. Copy ─────────────────────────────────────────────────────────
      await db.contentJob.update({ where: { id: job.id }, data: { stage: 'COPY' } });
      const caption = workflow.generateCaption(analysis, locale);
      const asset = await db.contentAsset.upsert({
        where: { contentJobId_format_version: { contentJobId: job.id, format: CAPTION_FORMAT, version: 1 } },
        create: {
          organizationId: p.organizationId,
          contentJobId: job.id,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          kind: 'TEXT',
          format: CAPTION_FORMAT,
          channel: 'INSTAGRAM',
          locale,
          // Automated QA arrives in Phase 8; until then generated copy waits in review.
          status: 'QA_REVIEW',
          text: caption.text,
          data: { usedFields: caption.usedFields },
          templateSlug: snap.templateSlug,
          provider: 'template-caption',
        },
        update: {},
      });
      log.info('copy generated', { event: LogEvent.COPY_GENERATED, usedFields: caption.usedFields, assetId: asset.id });

      // ── 4. Deliver ──────────────────────────────────────────────────────
      await db.contentJob.update({ where: { id: job.id }, data: { stage: 'DELIVERY' } });
      if (chatId !== null) {
        if (!job.analysisDeliveredAt) {
          await deps.notifier.sendHtml(chatId, workflow.formatSubjectForDisplay(analysis, locale, { mock: deps.mockMode }));
          await db.contentJob.update({ where: { id: job.id }, data: { analysisDeliveredAt: now() } });
        }
        if (!asset.deliveredAt) {
          await deps.notifier.sendHtml(chatId, `<b>${m.captionIntro}</b>\n\n${escapeHtml(asset.text ?? caption.text)}`);
          await db.contentAsset.update({ where: { id: asset.id }, data: { deliveredAt: now() } });
        }
      }

      await complete(job.id);
    } catch (err) {
      const retryable = !(err instanceof NonRetryableError);
      if (retryable && ctx.attempt < ctx.maxAttempts) {
        await db.contentJob
          .update({ where: { id: job.id }, data: { status: 'RETRYING', lastError: errorJson(err) } })
          .catch(() => undefined);
      }
      throw err;
    }

    /** Marks the job done exactly once (and counts the subject only then). */
    async function complete(jobId: string) {
      await deps.prisma.$transaction(async (tx) => {
        const res = await tx.contentJob.updateMany({
          where: { id: jobId, organizationId: p.organizationId, status: { notIn: [...FINISHED] } },
          data: { status: 'COMPLETED', stage: 'DONE', completedAt: now(), lastError: Prisma.DbNull },
        });
        if (res.count === 1) {
          await incrementUsage(tx, { organizationId: p.organizationId, day: localDay(now(), snap.timezone), metric: 'VEHICLES_PROCESSED' });
        }
      });
      log.info('content job completed', { event: LogEvent.JOB_COMPLETED });
    }
  };

  const onFinalFailure = async (p: ContentJobPayload, err: unknown, ctx: JobContext) => {
    const db = forOrganization(deps.prisma, p.organizationId);
    const job = await db.contentJob.findUnique({ where: { id: p.contentJobId } });
    if (!job || (FINISHED as readonly string[]).includes(job.status)) return;
    await db.contentJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', lastError: errorJson(err), attempts: ctx.attempt },
    });
    const snap = settingsSnapshotSchema.safeParse(job.settingsSnapshot);
    const locale: Locale = snap.success ? snap.data.locale : 'es';
    if (job.telegramChatId !== null) {
      await deps.notifier.sendText(Number(job.telegramChatId), failureText(err, locale, deps.limits));
    }
  };

  return { handler, onFinalFailure };
}

function errorJson(err: unknown): Prisma.InputJsonObject {
  const e = err instanceof Error ? err : new Error(String(err));
  // Messages from our own errors are safe; truncate anything else.
  return { code: e.name, message: e.message.slice(0, 300) };
}
