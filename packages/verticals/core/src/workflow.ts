import type { Prisma, PrismaClient } from '@autocontent/database';
import type { ProviderCallOptions, ProviderResult, VisionInput } from '@autocontent/providers';
import type { Locale } from '@autocontent/shared';

/**
 * What a job is about, in a module's own vocabulary. Stored on ContentJob
 * (and ContentAsset/VideoPlan) as `subjectType`/`subjectId` — a namespaced
 * string ("dealership.vehicle") plus the row id, with no database foreign
 * key: the module's own table (e.g. Vehicle) keeps the tenant-checked
 * uniqueness and composite foreign keys that matter; core only carries a
 * loose reference. See docs/phase-3-design.md §3.2 for why this trade was
 * made deliberately, not by default.
 */
export interface JobSubjectRef {
  subjectType: string;
  subjectId: string;
}

/**
 * The job-lifecycle contract a vertical module implements. Core's worker
 * shell (apps/worker) calls these hooks instead of inlining vertical-specific
 * logic — this is the boundary that replaced today's direct `db.vehicle.*`
 * calls and `vehicleUpdateFromAnalysis()` (docs/phase-3-design.md §7.2).
 *
 * `TAnalysis` is the module's own AI-output shape (e.g. dealership's
 * VehicleAnalysis) — core never needs to know its fields.
 */
/** A stored original photo, in the module's own image cache/table. */
export interface SubjectImage<TAnalysis> {
  imageId: string;
  storageKey: string;
  mime: string;
  width: number;
  height: number;
  sha256: string;
  analysis: TAnalysis | null;
}

export interface WorkflowHooks<TAnalysis = unknown> {
  /**
   * Create (or find) the module's own entity for a brand-new job, inside the
   * same transaction the core job row is created in. Returns the subject ref
   * core stores on ContentJob.
   */
  onJobCreate(ctx: { organizationId: string; tx: Prisma.TransactionClient }): Promise<JobSubjectRef>;

  /**
   * The module's analyzer, if it has one (a vertical with no photo-analysis
   * step, e.g. a scheduling-only module, omits this). Same call shape as
   * VisionProvider.analyze(), generic over the module's own output type.
   * Not currently called by the worker shell — vision stays its own injected
   * dependency (see apps/worker) — kept here for a future step that resolves
   * the analyzer through the module instead.
   */
  analyze?(input: VisionInput, opts: ProviderCallOptions): Promise<ProviderResult<TAnalysis>>;

  /**
   * Resume support: the original photo already stored for this subject, if
   * any (a retried or stalled job). Replaces today's direct
   * `db.vehicleImage.findFirst({ vehicleId })`.
   */
  getStoredImage(ctx: { subject: JobSubjectRef; organizationId: string; prisma: PrismaClient }): Promise<SubjectImage<TAnalysis> | null>;

  /**
   * Records a freshly downloaded+validated+stored photo on the module's own
   * table. If an identical photo (by hash) was already analysed for this
   * organization by the same provider, returns that analysis for reuse so
   * the caller can skip a provider call — replaces today's
   * `db.vehicleImage.findFirst({ sha256, analyzedAt: { not: null } })`.
   */
  storeImage(ctx: {
    subject: JobSubjectRef;
    organizationId: string;
    storageKey: string;
    mime: string;
    width: number;
    height: number;
    bytes: number;
    sha256: string;
    providerName: string;
    prisma: PrismaClient;
  }): Promise<{ imageId: string; reusedAnalysis: TAnalysis | null }>;

  /**
   * Persist a freshly computed (or reused) analysis onto the module's stored
   * image and its own entity. Replaces today's vehicleUpdateFromAnalysis()
   * and the VehicleImage.analysis write; must never overwrite a
   * user-provided fact.
   */
  onAnalysisComplete(ctx: { subject: JobSubjectRef; imageId: string; analysis: TAnalysis; providerName: string; tx: Prisma.TransactionClient }): Promise<void>;

  /**
   * Whether this analysis is usable at all (e.g. dealership: the photo shows
   * a single vehicle). Absent = always usable. On `usable: false`, core tells
   * the user `reasonKey` (a key into the module's own message fragment) and
   * stops the job before generating anything.
   */
  isSubjectUsable?(analysis: TAnalysis): { usable: true } | { usable: false; reasonKey: string };

  /** User-facing text for an `isSubjectUsable` rejection reasonKey, in the module's own locales. */
  describeUnusableReason?(reasonKey: string, locale: Locale): string;

  /** Called once when `isSubjectUsable` says no, so the module can archive/close its own entity. Absent = no-op. */
  markSubjectUnusable?(ctx: { subject: JobSubjectRef; prisma: PrismaClient }): Promise<void>;

  /** What's still missing after analysis, in the module's own vocabulary. */
  computeMissingInformation(analysis: TAnalysis): string[];

  /** Bot-facing rendering of the analysis. Replaces today's formatAnalysis(). */
  formatSubjectForDisplay(analysis: TAnalysis, locale: Locale, opts: { mock: boolean }): string;

  /** Ready-to-post copy. Replaces content-engine's generateCaption() call site. */
  generateCaption(analysis: TAnalysis, locale: Locale): { text: string; usedFields: string[] };

  /** Small, secret-free summary for GenerationLog.outputSummary and structured logs. Absent = {}. */
  describeAnalysisForLog?(analysis: TAnalysis): Record<string, unknown>;
}
