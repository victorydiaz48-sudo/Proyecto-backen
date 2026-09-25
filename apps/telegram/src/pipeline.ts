import { generateCaption } from '@autocontent/content-engine';
import type { VisionProvider } from '@autocontent/providers';
import type { ImageLimits, JobContext, Locale } from '@autocontent/shared';
import {
  ImageValidationError,
  LogEvent,
  ProviderNotConfiguredError,
  escapeHtml,
  messages,
  validateImage,
} from '@autocontent/shared';
import { formatAnalysis } from './format.js';
import type { ChatNotifier, TelegramFileFetcher } from './ports.js';

/** Everything the job needs, serialisable so it can move to Redis in Phase 2. */
export interface AnalyzePhotoPayload {
  jobId: string;
  chatId: number;
  telegramUserId: number;
  fileId: string;
  locale: Locale;
  receivedAt: string;
}

export interface PipelineDeps {
  vision: VisionProvider;
  notifier: ChatNotifier;
  files: TelegramFileFetcher;
  limits: ImageLimits;
  mockMode: boolean;
}

/**
 * Walking-skeleton pipeline: download → validate → analyse → caption → reply.
 * Steps are side-effect free until the replies, and each reply is recorded
 * once sent, so a retried job never sends a duplicate message. (In-memory for
 * now; Phase 2 persists step state in the database.)
 */
export function createAnalyzePhotoHandler(deps: PipelineDeps) {
  const sent = new Set<string>();
  const sendOnce = async (key: string, send: () => Promise<void>) => {
    if (sent.has(key)) return;
    await send();
    sent.add(key);
  };

  return async (p: AnalyzePhotoPayload, ctx: JobContext): Promise<void> => {
    const log = ctx.logger;

    const bytes = await deps.files.download(p.fileId, deps.limits.maxBytes);
    const image = validateImage(bytes, deps.limits);
    log.info('image received', {
      event: LogEvent.IMAGE_RECEIVED,
      mime: image.mime,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
    });

    const t0 = Date.now();
    const analysis = await deps.vision.analyze({ image: bytes, mime: image.mime, locale: p.locale, jobId: p.jobId });
    log.info('image analyzed', {
      event: LogEvent.IMAGE_ANALYZED,
      provider: deps.vision.name,
      durationMs: Date.now() - t0,
      confidence: analysis.confidence,
      make: analysis.make.value,
      model: analysis.model.value,
    });

    const caption = generateCaption(analysis, p.locale);
    log.info('copy generated', { event: LogEvent.COPY_GENERATED, usedFields: caption.usedFields });

    const m = messages(p.locale);
    await sendOnce(`${p.jobId}:analysis`, () =>
      deps.notifier.sendHtml(p.chatId, formatAnalysis(analysis, p.locale, { mock: deps.mockMode })),
    );
    await sendOnce(`${p.jobId}:caption`, () =>
      deps.notifier.sendHtml(p.chatId, `<b>${m.captionIntro}</b>\n\n${escapeHtml(caption.text)}`),
    );
    sent.delete(`${p.jobId}:analysis`);
    sent.delete(`${p.jobId}:caption`);
  };
}

/** Message shown to the user once a job has definitively failed. */
export function failureMessage(err: unknown, locale: Locale, limits: ImageLimits): string {
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
