import { BODY_TYPES, FIELD_SOURCES, SEGMENTS, qaReportSchema, videoPlanSchema } from '@autocontent/shared';
import { z } from 'zod';
import { httpUrl, isoDate, locale, microsUsd, paginationQuery, role, uuid } from './common.js';

// ───────────── Auth ─────────────
export const loginBody = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(200),
});
export const me = z.object({
  user: z.object({ id: uuid, email: z.string(), name: z.string(), role }),
  dealership: z.object({ id: uuid, name: z.string(), slug: z.string() }),
});

// ───────────── Dealership & settings ─────────────
export const PUBLISHING_MODES = ['DRAFT_ONLY', 'AUTO_PUBLISH', 'SCHEDULED'] as const;

export const dealership = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
  createdAt: isoDate,
});
export const dealershipPatch = z.object({ name: z.string().min(2).max(120) }).partial();

export const settings = z.object({
  locale,
  timezone: z.string(),
  currency: z.string().length(3),
  publishingMode: z.enum(PUBLISHING_MODES),
  defaultTemplateSlug: z.string(),
  defaultVideoStyle: z.string().nullable(),
  brandName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactWhatsapp: z.string().nullable(),
  contactEmail: z.string().nullable(),
  website: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  defaultHashtags: z.array(z.string()),
  videoEnabled: z.boolean(),
  monthlyCostCapMicros: microsUsd.nullable(),
  dailyJobLimit: z.number().int().nullable(),
  confirmCostAboveMicros: microsUsd,
});
export const settingsPatch = settings
  .extend({
    currency: z.string().regex(/^[A-Z]{3}$/),
    timezone: z.string().min(1).max(64),
    contactEmail: z.email().nullable(),
    website: httpUrl.nullable(),
    defaultHashtags: z.array(z.string().regex(/^#?[\p{L}\p{N}_]{1,50}$/u)).max(30),
    dailyJobLimit: z.number().int().min(0).max(10_000).nullable(),
  })
  .partial();

// ───────────── Users ─────────────
export const user = z.object({
  id: uuid,
  email: z.string(),
  name: z.string(),
  role,
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']),
  lastLoginAt: isoDate.nullable(),
  createdAt: isoDate,
});
export const userCreate = z.object({ email: z.email().max(254), name: z.string().min(1).max(120), role });
export const userPatch = z.object({ name: z.string().min(1).max(120), role, status: z.enum(['ACTIVE', 'DISABLED']) }).partial();

// ───────────── Telegram ─────────────
export const telegramInviteCreate = z.object({
  role: role.default('OPERATOR'),
  maxUses: z.number().int().min(1).max(50).default(1),
  expiresInHours: z.number().int().min(1).max(24 * 14).default(72),
});
export const telegramInvite = z.object({
  id: uuid,
  /** Shown once; only its hash is stored. */
  link: httpUrl,
  role,
  maxUses: z.number().int(),
  expiresAt: isoDate,
});
export const telegramAccount = z.object({
  id: uuid,
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  role,
  status: z.enum(['ACTIVE', 'BLOCKED']),
  localeOverride: locale.nullable(),
  userId: uuid.nullable(),
  lastSeenAt: isoDate.nullable(),
});
export const telegramAccountPatch = z
  .object({ status: z.enum(['ACTIVE', 'BLOCKED']), role, localeOverride: locale.nullable() })
  .partial();

// ───────────── Vehicles ─────────────
const provenanceEntry = z.object({ source: z.enum(FIELD_SOURCES), confidence: z.number().optional() });
export const VEHICLE_STATUSES = ['DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD', 'ARCHIVED'] as const;

export const vehicle = z.object({
  id: uuid,
  status: z.enum(VEHICLE_STATUSES),
  make: z.string().nullable(),
  model: z.string().nullable(),
  version: z.string().nullable(),
  year: z.number().int().nullable(),
  color: z.string().nullable(),
  bodyType: z.enum(BODY_TYPES).nullable(),
  segment: z.enum(SEGMENTS).nullable(),
  provenance: z.record(z.string(), provenanceEntry),
  visualFeatures: z.array(z.object({ value: z.string(), source: z.enum(['detected', 'inferred']) })),
  priceMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  mileageKm: z.number().int().nullable(),
  city: z.string().nullable(),
  financingNotes: z.string().nullable(),
  offerText: z.string().nullable(),
  primaryImageUrl: httpUrl.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export const vehicleListQuery = paginationQuery.extend({
  status: z.enum(VEHICLE_STATUSES).optional(),
  q: z.string().max(100).optional(),
});
/** Only user-provided facts are editable; identity edits are tagged "user-provided". */
export const vehiclePatch = z
  .object({
    status: z.enum(VEHICLE_STATUSES),
    make: z.string().min(1).max(60),
    model: z.string().min(1).max(60),
    version: z.string().min(1).max(60),
    year: z.number().int().min(1950).max(2100),
    color: z.string().min(1).max(60),
    priceMinor: z.number().int().min(0).max(1_000_000_000_00),
    currency: z.string().regex(/^[A-Z]{3}$/),
    mileageKm: z.number().int().min(0).max(5_000_000),
    city: z.string().min(1).max(80),
    financingNotes: z.string().max(500),
    offerText: z.string().max(500),
    vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{11,17}$/i),
    stockNumber: z.string().max(40),
  })
  .partial();

// ───────────── Jobs ─────────────
export const JOB_STATUSES = [
  'PENDING',
  'PROCESSING',
  'AWAITING_INPUT',
  'RETRYING',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export const JOB_STAGES = ['INGEST', 'ANALYSIS', 'COLLECTING_INPUT', 'COPY', 'IMAGES', 'VIDEO', 'QA', 'DELIVERY', 'PUBLISHING', 'DONE'] as const;

export const job = z.object({
  id: uuid,
  vehicleId: uuid,
  source: z.enum(['TELEGRAM', 'DASHBOARD', 'API']),
  status: z.enum(JOB_STATUSES),
  stage: z.enum(JOB_STAGES),
  requestedFormats: z.array(z.string()),
  templateSlug: z.string().nullable(),
  videoStyle: z.string().nullable(),
  estimatedCostMicros: microsUsd,
  actualCostMicros: microsUsd,
  attempts: z.number().int(),
  lastError: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: isoDate,
  completedAt: isoDate.nullable(),
});
export const jobListQuery = paginationQuery.extend({
  status: z.enum(JOB_STATUSES).optional(),
  vehicleId: uuid.optional(),
});
/**
 * Dashboard upload: the API returns a short-lived signed PUT URL; the browser
 * uploads the photo directly to storage, then calls POST /jobs/:id/start.
 */
export const jobCreate = z.object({
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  bytes: z.number().int().positive().max(20 * 1024 * 1024),
  requestedFormats: z.array(z.string().min(1)).min(1).max(12),
  templateSlug: z.string().optional(),
  videoStyle: z.string().optional(),
  campaignId: uuid.optional(),
});
export const jobCreated = z.object({ job, upload: z.object({ url: httpUrl, expiresAt: isoDate }) });

// ───────────── Assets ─────────────
export const ASSET_KINDS = ['TEXT', 'IMAGE', 'VIDEO', 'THUMBNAIL', 'METADATA'] as const;
export const ASSET_STATUSES = ['PENDING', 'GENERATING', 'QA_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'] as const;
export const CHANNELS = [
  'INSTAGRAM',
  'FACEBOOK',
  'TIKTOK',
  'YOUTUBE',
  'LINKEDIN',
  'X',
  'THREADS',
  'PINTEREST',
  'BLUESKY',
  'WHATSAPP',
  'MARKETPLACE',
  'WEBSITE',
  'GENERIC',
] as const;

export const asset = z.object({
  id: uuid,
  contentJobId: uuid,
  vehicleId: uuid,
  kind: z.enum(ASSET_KINDS),
  format: z.string(),
  channel: z.enum(CHANNELS),
  locale,
  status: z.enum(ASSET_STATUSES),
  version: z.number().int(),
  isCurrent: z.boolean(),
  text: z.string().nullable(),
  data: z.unknown().nullable(),
  /** Short-lived signed URL for media assets. */
  url: httpUrl.nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  provider: z.string().nullable(),
  templateSlug: z.string().nullable(),
  qaReport: qaReportSchema.nullable(),
  approvedAt: isoDate.nullable(),
  createdAt: isoDate,
});
export const assetListQuery = paginationQuery.extend({
  jobId: uuid.optional(),
  vehicleId: uuid.optional(),
  kind: z.enum(ASSET_KINDS).optional(),
  currentOnly: z.coerce.boolean().default(true),
});
export const assetRegenerate = z.object({ instructions: z.string().max(500).optional() });

export const videoPlan = z.object({ id: uuid, style: z.string(), status: z.string(), plan: videoPlanSchema });

// ───────────── Templates ─────────────
export const templateSummary = z.object({
  slug: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  formats: z.array(z.string()),
  videoStyles: z.array(z.string()),
});

// ───────────── Campaigns ─────────────
export const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'] as const;
export const campaign = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(CAMPAIGN_STATUSES),
  startsAt: isoDate.nullable(),
  endsAt: isoDate.nullable(),
  offerText: z.string().nullable(),
  templateSlug: z.string().nullable(),
  createdAt: isoDate,
});
export const campaignCreate = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
    offerText: z.string().max(500).optional(),
    templateSlug: z.string().optional(),
  })
  .refine((c) => !c.startsAt || !c.endsAt || c.startsAt < c.endsAt, { message: 'endsAt must be after startsAt' });
export const campaignPatch = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(1000).nullable(),
    status: z.enum(CAMPAIGN_STATUSES),
    startsAt: isoDate.nullable(),
    endsAt: isoDate.nullable(),
    offerText: z.string().max(500).nullable(),
    templateSlug: z.string().nullable(),
  })
  .partial();

// ───────────── Publishing ─────────────
export const SOCIAL_CHANNELS = ['INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'YOUTUBE', 'LINKEDIN', 'X', 'THREADS', 'PINTEREST', 'BLUESKY'] as const;
export const publishingAccount = z.object({
  id: uuid,
  provider: z.string(),
  platform: z.enum(SOCIAL_CHANNELS),
  externalAccountId: z.string(),
  displayName: z.string(),
  handle: z.string().nullable(),
  status: z.enum(['ACTIVE', 'DISCONNECTED', 'ERROR']),
  lastSyncedAt: isoDate.nullable(),
});
export const publicationCreate = z.object({
  contentJobId: uuid,
  publishingAccountId: uuid,
  primaryAssetId: uuid,
  mediaAssetIds: z.array(uuid).max(10).default([]),
  /** Absent = now (only if the dealership allows auto-publish). */
  scheduledAt: isoDate.optional(),
});
export const PUBLICATION_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED'] as const;
export const publication = z.object({
  id: uuid,
  contentJobId: uuid,
  publishingAccountId: uuid,
  primaryAssetId: uuid,
  mediaAssetIds: z.array(uuid),
  status: z.enum(PUBLICATION_STATUSES),
  scheduledAt: isoDate.nullable(),
  publishedAt: isoDate.nullable(),
  externalUrl: httpUrl.nullable(),
  lastError: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: isoDate,
});
export const publicationListQuery = paginationQuery.extend({ status: z.enum(PUBLICATION_STATUSES).optional() });

// ───────────── Integrations & API keys ─────────────
export const PROVIDER_KINDS = [
  'TELEGRAM',
  'VISION',
  'TEXT_GENERATION',
  'IMAGE_GENERATION',
  'VIDEO_GENERATION',
  'STORAGE',
  'SOCIAL_PUBLISHING',
  'ANALYTICS',
] as const;
export const integration = z.object({
  adapter: z.string(),
  kind: z.enum(PROVIDER_KINDS),
  displayName: z.string(),
  scope: z.enum(['platform', 'dealership']),
  enabled: z.boolean(),
  health: z.enum(['CONNECTED', 'NOT_CONFIGURED', 'ERROR']),
  healthDetail: z.string().nullable(),
  lastCheckedAt: isoDate.nullable(),
  /** Only the last 4 characters of a configured key are ever returned. */
  keyLast4: z.string().nullable(),
});
export const integrationTestResult = z.object({
  adapter: z.string(),
  state: z.enum(['CONNECTED', 'NOT_CONFIGURED', 'ERROR']),
  detail: z.string().optional(),
  latencyMs: z.number().optional(),
});
export const adapterParams = z.object({ adapter: z.string().regex(/^[a-z0-9-]{2,64}$/) });
/** Write-only: the key is encrypted at rest and never returned. */
export const apiKeyPut = z.object({ apiKey: z.string().min(8).max(500), label: z.string().max(80).optional() });
export const apiKeySaved = z.object({ adapter: z.string(), keyLast4: z.string(), savedAt: isoDate });

// ───────────── Usage & audit ─────────────
export const USAGE_METRICS = [
  'JOBS_CREATED',
  'VEHICLES_PROCESSED',
  'VISION_CALLS',
  'TEXT_GENERATIONS',
  'IMAGES_GENERATED',
  'VIDEOS_GENERATED',
  'VIDEO_SECONDS',
  'PUBLICATIONS',
] as const;
export const usageQuery = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  groupBy: z.enum(['day', 'metric', 'provider']).default('day'),
});
export const usageRow = z.object({
  day: z.iso.date().optional(),
  metric: z.enum(USAGE_METRICS).optional(),
  providerAdapter: z.string().optional(),
  quantity: z.string(),
  costMicros: microsUsd,
});
export const usageReport = z.object({ rows: z.array(usageRow), totalCostMicros: microsUsd, currency: z.string() });
export const usageSummary = z.object({
  period: z.object({ from: z.iso.date(), to: z.iso.date() }),
  vehiclesProcessed: z.number().int(),
  contentGenerated: z.number().int(),
  videosGenerated: z.number().int(),
  failedJobs: z.number().int(),
  successfulPublications: z.number().int(),
  costMicros: microsUsd,
  costCapMicros: microsUsd.nullable(),
  /** Cost converted to the dealership's display currency. */
  costDisplay: z.string(),
});
export const auditLog = z.object({
  id: uuid,
  actorType: z.enum(['USER', 'TELEGRAM', 'SYSTEM']),
  actorUserId: uuid.nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: isoDate,
});
export const auditLogQuery = paginationQuery.extend({ action: z.string().max(80).optional() });

// ───────────── System ─────────────
export const health = z.object({ status: z.enum(['ok', 'degraded']), version: z.string().optional() });
export const readiness = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.enum(['ok', 'error', 'not_configured'])),
});
