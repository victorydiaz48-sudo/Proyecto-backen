import type { Prisma } from '@autocontent/database';
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
   */
  analyze?(input: VisionInput, opts: ProviderCallOptions): Promise<ProviderResult<TAnalysis>>;

  /**
   * Persist analysis results onto the module's own entity. Replaces today's
   * vehicleUpdateFromAnalysis(); must never overwrite a user-provided fact.
   */
  onAnalysisComplete(ctx: { subject: JobSubjectRef; analysis: TAnalysis; tx: Prisma.TransactionClient }): Promise<void>;

  /** What's still missing after analysis, in the module's own vocabulary. */
  computeMissingInformation(analysis: TAnalysis): string[];

  /** Bot-facing rendering of the analysis. Replaces today's formatAnalysis(). */
  formatSubjectForDisplay(analysis: TAnalysis, locale: Locale, opts: { mock: boolean }): string;

  /** Ready-to-post copy. Replaces content-engine's generateCaption() call site. */
  generateCaption(analysis: TAnalysis, locale: Locale): { text: string; usedFields: string[] };
}
