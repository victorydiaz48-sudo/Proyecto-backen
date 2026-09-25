-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'OPERATOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DealershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('es', 'pt', 'en');

-- CreateEnum
CREATE TYPE "PublishingMode" AS ENUM ('DRAFT_ONLY', 'AUTO_PUBLISH', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "TelegramAccountStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BodyType" AS ENUM ('SEDAN', 'HATCHBACK', 'SUV', 'CROSSOVER', 'PICKUP', 'COUPE', 'CONVERTIBLE', 'WAGON', 'VAN', 'OTHER');

-- CreateEnum
CREATE TYPE "Segment" AS ENUM ('ECONOMY', 'MID_RANGE', 'PREMIUM', 'LUXURY', 'SPORT', 'UTILITY');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('TELEGRAM', 'DASHBOARD', 'API');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'AWAITING_INPUT', 'RETRYING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStage" AS ENUM ('INGEST', 'ANALYSIS', 'COLLECTING_INPUT', 'COPY', 'IMAGES', 'VIDEO', 'QA', 'DELIVERY', 'PUBLISHING', 'DONE');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'THUMBNAIL', 'METADATA');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'GENERATING', 'QA_REVIEW', 'APPROVED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'YOUTUBE', 'LINKEDIN', 'X', 'THREADS', 'PINTEREST', 'BLUESKY', 'WHATSAPP', 'MARKETPLACE', 'WEBSITE', 'GENERIC');

-- CreateEnum
CREATE TYPE "VideoPlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'RENDERING', 'RENDERED', 'FAILED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('TELEGRAM', 'VISION', 'TEXT_GENERATION', 'IMAGE_GENERATION', 'VIDEO_GENERATION', 'STORAGE', 'SOCIAL_PUBLISHING', 'ANALYTICS');

-- CreateEnum
CREATE TYPE "ProviderHealth" AS ENUM ('CONNECTED', 'NOT_CONFIGURED', 'ERROR');

-- CreateEnum
CREATE TYPE "KeySource" AS ENUM ('ENV', 'DATABASE');

-- CreateEnum
CREATE TYPE "PublishingAccountStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GenerationOperation" AS ENUM ('VISION_ANALYZE', 'TEXT_GENERATE', 'IMAGE_GENERATE', 'VIDEO_GENERATE', 'QA_REVIEW', 'PUBLISH');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('SUCCESS', 'ERROR', 'TIMEOUT', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('JOBS_CREATED', 'VEHICLES_PROCESSED', 'VISION_CALLS', 'TEXT_GENERATIONS', 'IMAGES_GENERATED', 'VIDEOS_GENERATED', 'VIDEO_SECONDS', 'PUBLICATIONS');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'TELEGRAM', 'SYSTEM');

-- CreateTable
CREATE TABLE "Dealership" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "DealershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dealership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealershipSettings" (
    "dealershipId" UUID NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'es',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "publishingMode" "PublishingMode" NOT NULL DEFAULT 'DRAFT_ONLY',
    "defaultTemplateSlug" TEXT NOT NULL DEFAULT 'premium-dealership',
    "defaultVideoStyle" TEXT,
    "brandName" TEXT,
    "contactPhone" TEXT,
    "contactWhatsapp" TEXT,
    "contactEmail" TEXT,
    "website" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "defaultHashtags" TEXT[],
    "videoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyCostCapMicros" BIGINT,
    "dailyJobLimit" INTEGER,
    "confirmCostAboveMicros" BIGINT NOT NULL DEFAULT 0,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealershipSettings_pkey" PRIMARY KEY ("dealershipId")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "planCode" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "monthlyVehicleLimit" INTEGER,
    "monthlyVideoLimit" INTEGER,
    "dailyJobLimit" INTEGER,
    "monthlyCostCapMicros" BIGINT,
    "externalCustomerId" TEXT,
    "externalSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramAccount" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "userId" UUID,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "status" "TelegramAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "localeOverride" "Locale",
    "activeContentJobId" UUID,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramInvite" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'DRAFT',
    "make" TEXT,
    "model" TEXT,
    "version" TEXT,
    "year" INTEGER,
    "color" TEXT,
    "bodyType" "BodyType",
    "segment" "Segment",
    "provenance" JSONB NOT NULL,
    "visualFeatures" JSONB NOT NULL,
    "priceMinor" INTEGER,
    "currency" CHAR(3),
    "mileageKm" INTEGER,
    "city" TEXT,
    "financingNotes" TEXT,
    "offerText" TEXT,
    "contactPhoneOverride" TEXT,
    "vin" TEXT,
    "stockNumber" TEXT,
    "primaryImageId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleImage" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "telegramFileUniqueId" TEXT,
    "analysis" JSONB,
    "analyzedBy" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentJob" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "source" "JobSource" NOT NULL,
    "telegramAccountId" UUID,
    "telegramChatId" BIGINT,
    "progressMessageId" INTEGER,
    "requestedById" UUID,
    "campaignId" UUID,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "stage" "JobStage" NOT NULL DEFAULT 'INGEST',
    "requestedFormats" TEXT[],
    "templateSlug" TEXT,
    "videoStyle" TEXT,
    "settingsSnapshot" JSONB NOT NULL,
    "analysisDeliveredAt" TIMESTAMP(3),
    "estimatedCostMicros" BIGINT NOT NULL DEFAULT 0,
    "reservedCostMicros" BIGINT NOT NULL DEFAULT 0,
    "actualCostMicros" BIGINT NOT NULL DEFAULT 0,
    "costConfirmedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentAsset" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "contentJobId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "format" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "locale" "Locale" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "text" TEXT,
    "data" JSONB,
    "storageKey" TEXT,
    "mime" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "bytes" INTEGER,
    "templateSlug" TEXT,
    "templateVersion" TEXT,
    "provider" TEXT,
    "generationLogId" UUID,
    "qaReport" JSONB,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoPlan" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "contentJobId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "style" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "status" "VideoPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "videoAssetId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "offerText" TEXT,
    "templateSlug" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APIProvider" (
    "id" UUID NOT NULL,
    "dealershipId" UUID,
    "kind" "ProviderKind" NOT NULL,
    "adapter" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "costConfig" JSONB NOT NULL,
    "health" "ProviderHealth" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "healthDetail" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "APIProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APIKeyReference" (
    "id" UUID NOT NULL,
    "dealershipId" UUID,
    "providerId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "source" "KeySource" NOT NULL,
    "envVarName" TEXT,
    "ciphertext" BYTEA,
    "iv" BYTEA,
    "authTag" BYTEA,
    "encryptionKeyVersion" INTEGER,
    "last4" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "APIKeyReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishingAccount" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "apiKeyRefId" UUID,
    "platform" "Channel" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "handle" TEXT,
    "status" "PublishingAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "contentJobId" UUID NOT NULL,
    "publishingAccountId" UUID NOT NULL,
    "primaryAssetId" UUID NOT NULL,
    "mediaAssetIds" UUID[],
    "idempotencyKey" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "payloadSnapshot" JSONB,
    "lastError" JSONB,
    "requestedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationLog" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "contentJobId" UUID,
    "providerId" UUID,
    "adapter" TEXT NOT NULL,
    "operation" "GenerationOperation" NOT NULL,
    "model" TEXT,
    "promptTemplate" TEXT,
    "promptVersion" TEXT,
    "promptText" TEXT,
    "inputSummary" JSONB,
    "outputSummary" JSONB,
    "status" "CallStatus" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempt" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "units" DECIMAL(14,4),
    "unitType" TEXT,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usage" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "providerAdapter" TEXT NOT NULL DEFAULT '',
    "quantity" BIGINT NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" UUID,
    "actorTelegramAccountId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dealership_slug_key" ON "Dealership"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_dealershipId_key" ON "Subscription"("dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_dealershipId_idx" ON "User"("dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_dealershipId_key" ON "User"("id", "dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_dealershipId_idx" ON "Session"("dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAccount_telegramUserId_key" ON "TelegramAccount"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAccount_userId_key" ON "TelegramAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAccount_activeContentJobId_key" ON "TelegramAccount"("activeContentJobId");

-- CreateIndex
CREATE INDEX "TelegramAccount_dealershipId_idx" ON "TelegramAccount"("dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAccount_id_dealershipId_key" ON "TelegramAccount"("id", "dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramInvite_codeHash_key" ON "TelegramInvite"("codeHash");

-- CreateIndex
CREATE INDEX "TelegramInvite_dealershipId_idx" ON "TelegramInvite"("dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_primaryImageId_key" ON "Vehicle"("primaryImageId");

-- CreateIndex
CREATE INDEX "Vehicle_dealershipId_status_createdAt_idx" ON "Vehicle"("dealershipId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Vehicle_dealershipId_make_model_idx" ON "Vehicle"("dealershipId", "make", "model");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_id_dealershipId_key" ON "Vehicle"("id", "dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleImage_storageKey_key" ON "VehicleImage"("storageKey");

-- CreateIndex
CREATE INDEX "VehicleImage_dealershipId_sha256_idx" ON "VehicleImage"("dealershipId", "sha256");

-- CreateIndex
CREATE INDEX "VehicleImage_vehicleId_idx" ON "VehicleImage"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleImage_id_dealershipId_key" ON "VehicleImage"("id", "dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentJob_idempotencyKey_key" ON "ContentJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ContentJob_dealershipId_status_createdAt_idx" ON "ContentJob"("dealershipId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentJob_dealershipId_vehicleId_idx" ON "ContentJob"("dealershipId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentJob_id_dealershipId_key" ON "ContentJob"("id", "dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentAsset_generationLogId_key" ON "ContentAsset"("generationLogId");

-- CreateIndex
CREATE INDEX "ContentAsset_dealershipId_vehicleId_idx" ON "ContentAsset"("dealershipId", "vehicleId");

-- CreateIndex
CREATE INDEX "ContentAsset_dealershipId_status_idx" ON "ContentAsset"("dealershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentAsset_id_dealershipId_key" ON "ContentAsset"("id", "dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentAsset_contentJobId_format_version_key" ON "ContentAsset"("contentJobId", "format", "version");

-- CreateIndex
CREATE UNIQUE INDEX "VideoPlan_videoAssetId_key" ON "VideoPlan"("videoAssetId");

-- CreateIndex
CREATE INDEX "VideoPlan_dealershipId_idx" ON "VideoPlan"("dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoPlan_contentJobId_style_key" ON "VideoPlan"("contentJobId", "style");

-- CreateIndex
CREATE INDEX "Campaign_dealershipId_status_idx" ON "Campaign"("dealershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_id_dealershipId_key" ON "Campaign"("id", "dealershipId");

-- CreateIndex
CREATE INDEX "APIProvider_kind_idx" ON "APIProvider"("kind");

-- CreateIndex
CREATE INDEX "APIProvider_dealershipId_idx" ON "APIProvider"("dealershipId");

-- CreateIndex
CREATE INDEX "APIKeyReference_providerId_idx" ON "APIKeyReference"("providerId");

-- CreateIndex
CREATE INDEX "APIKeyReference_dealershipId_idx" ON "APIKeyReference"("dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishingAccount_id_dealershipId_key" ON "PublishingAccount"("id", "dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishingAccount_dealershipId_providerId_platform_external_key" ON "PublishingAccount"("dealershipId", "providerId", "platform", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_idempotencyKey_key" ON "Publication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Publication_dealershipId_status_scheduledAt_idx" ON "Publication"("dealershipId", "status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationLog_idempotencyKey_key" ON "GenerationLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GenerationLog_dealershipId_createdAt_idx" ON "GenerationLog"("dealershipId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationLog_contentJobId_idx" ON "GenerationLog"("contentJobId");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationLog_id_dealershipId_key" ON "GenerationLog"("id", "dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Usage_dealershipId_day_metric_providerAdapter_key" ON "Usage"("dealershipId", "day", "metric", "providerAdapter");

-- CreateIndex
CREATE INDEX "AuditLog_dealershipId_createdAt_idx" ON "AuditLog"("dealershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "DealershipSettings" ADD CONSTRAINT "DealershipSettings_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramAccount" ADD CONSTRAINT "TelegramAccount_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramAccount" ADD CONSTRAINT "TelegramAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramAccount" ADD CONSTRAINT "TelegramAccount_activeContentJobId_fkey" FOREIGN KEY ("activeContentJobId") REFERENCES "ContentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramInvite" ADD CONSTRAINT "TelegramInvite_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleImage" ADD CONSTRAINT "VehicleImage_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleImage" ADD CONSTRAINT "VehicleImage_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentJob" ADD CONSTRAINT "ContentJob_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentJob" ADD CONSTRAINT "ContentJob_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentJob" ADD CONSTRAINT "ContentJob_telegramAccountId_fkey" FOREIGN KEY ("telegramAccountId") REFERENCES "TelegramAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentJob" ADD CONSTRAINT "ContentJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_contentJobId_fkey" FOREIGN KEY ("contentJobId") REFERENCES "ContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_generationLogId_fkey" FOREIGN KEY ("generationLogId") REFERENCES "GenerationLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoPlan" ADD CONSTRAINT "VideoPlan_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoPlan" ADD CONSTRAINT "VideoPlan_contentJobId_fkey" FOREIGN KEY ("contentJobId") REFERENCES "ContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoPlan" ADD CONSTRAINT "VideoPlan_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoPlan" ADD CONSTRAINT "VideoPlan_videoAssetId_fkey" FOREIGN KEY ("videoAssetId") REFERENCES "ContentAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APIProvider" ADD CONSTRAINT "APIProvider_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APIKeyReference" ADD CONSTRAINT "APIKeyReference_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APIKeyReference" ADD CONSTRAINT "APIKeyReference_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "APIProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingAccount" ADD CONSTRAINT "PublishingAccount_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingAccount" ADD CONSTRAINT "PublishingAccount_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "APIProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingAccount" ADD CONSTRAINT "PublishingAccount_apiKeyRefId_fkey" FOREIGN KEY ("apiKeyRefId") REFERENCES "APIKeyReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_contentJobId_fkey" FOREIGN KEY ("contentJobId") REFERENCES "ContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_publishingAccountId_fkey" FOREIGN KEY ("publishingAccountId") REFERENCES "PublishingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_primaryAssetId_fkey" FOREIGN KEY ("primaryAssetId") REFERENCES "ContentAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationLog" ADD CONSTRAINT "GenerationLog_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationLog" ADD CONSTRAINT "GenerationLog_contentJobId_fkey" FOREIGN KEY ("contentJobId") REFERENCES "ContentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationLog" ADD CONSTRAINT "GenerationLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "APIProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- TENANT BOUNDARY (hand-written; Prisma cannot express these)
--
-- Composite (childId, dealershipId) → parent(id, dealershipId) foreign keys:
-- a row can only reference rows of its own dealership, whatever the
-- application does. NULL child ids are not checked (MATCH SIMPLE), so optional
-- relations keep working. ON DELETE SET NULL (col) needs PostgreSQL 15+.
--
-- All constraint names start with "tenant_" so tests (and reviewers of future
-- generated migrations) can verify none has been dropped.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX "APIKeyReference_id_dealershipId_key" ON "APIKeyReference"("id", "dealershipId");

ALTER TABLE "Session" ADD CONSTRAINT "tenant_Session_user"
  FOREIGN KEY ("userId", "dealershipId") REFERENCES "User"("id", "dealershipId") ON DELETE CASCADE;

ALTER TABLE "TelegramAccount" ADD CONSTRAINT "tenant_TelegramAccount_user"
  FOREIGN KEY ("userId", "dealershipId") REFERENCES "User"("id", "dealershipId") ON DELETE SET NULL ("userId");
ALTER TABLE "TelegramAccount" ADD CONSTRAINT "tenant_TelegramAccount_activeJob"
  FOREIGN KEY ("activeContentJobId", "dealershipId") REFERENCES "ContentJob"("id", "dealershipId") ON DELETE SET NULL ("activeContentJobId");

ALTER TABLE "Vehicle" ADD CONSTRAINT "tenant_Vehicle_primaryImage"
  FOREIGN KEY ("primaryImageId", "dealershipId") REFERENCES "VehicleImage"("id", "dealershipId") ON DELETE SET NULL ("primaryImageId");
ALTER TABLE "VehicleImage" ADD CONSTRAINT "tenant_VehicleImage_vehicle"
  FOREIGN KEY ("vehicleId", "dealershipId") REFERENCES "Vehicle"("id", "dealershipId") ON DELETE CASCADE;

ALTER TABLE "ContentJob" ADD CONSTRAINT "tenant_ContentJob_vehicle"
  FOREIGN KEY ("vehicleId", "dealershipId") REFERENCES "Vehicle"("id", "dealershipId") ON DELETE CASCADE;
ALTER TABLE "ContentJob" ADD CONSTRAINT "tenant_ContentJob_telegramAccount"
  FOREIGN KEY ("telegramAccountId", "dealershipId") REFERENCES "TelegramAccount"("id", "dealershipId") ON DELETE SET NULL ("telegramAccountId");
ALTER TABLE "ContentJob" ADD CONSTRAINT "tenant_ContentJob_campaign"
  FOREIGN KEY ("campaignId", "dealershipId") REFERENCES "Campaign"("id", "dealershipId") ON DELETE SET NULL ("campaignId");

ALTER TABLE "ContentAsset" ADD CONSTRAINT "tenant_ContentAsset_contentJob"
  FOREIGN KEY ("contentJobId", "dealershipId") REFERENCES "ContentJob"("id", "dealershipId") ON DELETE CASCADE;
ALTER TABLE "ContentAsset" ADD CONSTRAINT "tenant_ContentAsset_vehicle"
  FOREIGN KEY ("vehicleId", "dealershipId") REFERENCES "Vehicle"("id", "dealershipId") ON DELETE CASCADE;
ALTER TABLE "ContentAsset" ADD CONSTRAINT "tenant_ContentAsset_generationLog"
  FOREIGN KEY ("generationLogId", "dealershipId") REFERENCES "GenerationLog"("id", "dealershipId") ON DELETE SET NULL ("generationLogId");

ALTER TABLE "VideoPlan" ADD CONSTRAINT "tenant_VideoPlan_contentJob"
  FOREIGN KEY ("contentJobId", "dealershipId") REFERENCES "ContentJob"("id", "dealershipId") ON DELETE CASCADE;
ALTER TABLE "VideoPlan" ADD CONSTRAINT "tenant_VideoPlan_vehicle"
  FOREIGN KEY ("vehicleId", "dealershipId") REFERENCES "Vehicle"("id", "dealershipId") ON DELETE CASCADE;
ALTER TABLE "VideoPlan" ADD CONSTRAINT "tenant_VideoPlan_videoAsset"
  FOREIGN KEY ("videoAssetId", "dealershipId") REFERENCES "ContentAsset"("id", "dealershipId") ON DELETE SET NULL ("videoAssetId");

-- A dealership's publishing account may only use that dealership's own key
-- (platform keys have dealershipId NULL and therefore never match).
ALTER TABLE "PublishingAccount" ADD CONSTRAINT "tenant_PublishingAccount_apiKeyRef"
  FOREIGN KEY ("apiKeyRefId", "dealershipId") REFERENCES "APIKeyReference"("id", "dealershipId") ON DELETE SET NULL ("apiKeyRefId");

ALTER TABLE "Publication" ADD CONSTRAINT "tenant_Publication_contentJob"
  FOREIGN KEY ("contentJobId", "dealershipId") REFERENCES "ContentJob"("id", "dealershipId") ON DELETE CASCADE;
ALTER TABLE "Publication" ADD CONSTRAINT "tenant_Publication_publishingAccount"
  FOREIGN KEY ("publishingAccountId", "dealershipId") REFERENCES "PublishingAccount"("id", "dealershipId");
ALTER TABLE "Publication" ADD CONSTRAINT "tenant_Publication_primaryAsset"
  FOREIGN KEY ("primaryAssetId", "dealershipId") REFERENCES "ContentAsset"("id", "dealershipId");

ALTER TABLE "GenerationLog" ADD CONSTRAINT "tenant_GenerationLog_contentJob"
  FOREIGN KEY ("contentJobId", "dealershipId") REFERENCES "ContentJob"("id", "dealershipId") ON DELETE SET NULL ("contentJobId");

-- Provider catalogue: one platform row per adapter, one override per dealership+adapter.
CREATE UNIQUE INDEX "tenant_APIProvider_platform_adapter" ON "APIProvider"("adapter") WHERE "dealershipId" IS NULL;
CREATE UNIQUE INDEX "tenant_APIProvider_dealership_adapter" ON "APIProvider"("dealershipId", "adapter") WHERE "dealershipId" IS NOT NULL;

-- Credentials must say where the secret lives.
ALTER TABLE "APIKeyReference" ADD CONSTRAINT "tenant_APIKeyReference_source_check" CHECK (
  ("source" = 'ENV' AND "envVarName" IS NOT NULL AND "ciphertext" IS NULL)
  OR ("source" = 'DATABASE' AND "ciphertext" IS NOT NULL AND "iv" IS NOT NULL AND "authTag" IS NOT NULL)
);

-- Sanity checks on counters and money.
ALTER TABLE "Usage" ADD CONSTRAINT "tenant_Usage_non_negative" CHECK ("quantity" >= 0 AND "costMicros" >= 0);
ALTER TABLE "ContentJob" ADD CONSTRAINT "tenant_ContentJob_costs_non_negative"
  CHECK ("estimatedCostMicros" >= 0 AND "reservedCostMicros" >= 0 AND "actualCostMicros" >= 0);
ALTER TABLE "ContentAsset" ADD CONSTRAINT "tenant_ContentAsset_version_positive" CHECK ("version" >= 1);
ALTER TABLE "TelegramInvite" ADD CONSTRAINT "tenant_TelegramInvite_uses" CHECK ("uses" >= 0 AND "uses" <= "maxUses");
