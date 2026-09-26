-- Pure rename: Dealership -> Organization (tenant concept, generalized for
-- multi-vertical support). Every statement is a RENAME (table/column/type/
-- index/constraint) — no data is dropped or recreated, existing rows survive
-- untouched. Reversible by re-running with old/new swapped.
--
-- Naming facts this migration relies on (verified against the live schema):
--   - only *_pkey and *_fkey are real table constraints (ALTER TABLE ... RENAME CONSTRAINT)
--   - every *_key and *_idx name, plus tenant_APIProvider_dealership_adapter,
--     is a bare index (ALTER INDEX ... RENAME TO)
--   - every tenant_* constraint's name already contains no "dealership"
--     substring and needs no statement here

-- ── Enum type ──
ALTER TYPE "DealershipStatus" RENAME TO "OrganizationStatus";

-- ── Root tenant table ──
ALTER TABLE "Dealership" RENAME TO "Organization";
ALTER TABLE "Organization" RENAME CONSTRAINT "Dealership_pkey" TO "Organization_pkey";
ALTER INDEX "Dealership_slug_key" RENAME TO "Organization_slug_key";

-- ── DealershipSettings -> OrganizationSettings (PK column too) ──
ALTER TABLE "DealershipSettings" RENAME TO "OrganizationSettings";
ALTER TABLE "OrganizationSettings" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "OrganizationSettings" RENAME CONSTRAINT "DealershipSettings_pkey" TO "OrganizationSettings_pkey";
ALTER TABLE "OrganizationSettings" RENAME CONSTRAINT "DealershipSettings_dealershipId_fkey" TO "OrganizationSettings_organizationId_fkey";

-- ── Every other tenant table ──

ALTER TABLE "Subscription" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "Subscription" RENAME CONSTRAINT "Subscription_dealershipId_fkey" TO "Subscription_organizationId_fkey";
ALTER INDEX "Subscription_dealershipId_key" RENAME TO "Subscription_organizationId_key";

ALTER TABLE "User" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "User" RENAME CONSTRAINT "User_dealershipId_fkey" TO "User_organizationId_fkey";
ALTER INDEX "User_id_dealershipId_key" RENAME TO "User_id_organizationId_key";
ALTER INDEX "User_dealershipId_idx" RENAME TO "User_organizationId_idx";

ALTER TABLE "Session" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "Session" RENAME CONSTRAINT "Session_dealershipId_fkey" TO "Session_organizationId_fkey";
ALTER INDEX "Session_dealershipId_idx" RENAME TO "Session_organizationId_idx";

ALTER TABLE "TelegramAccount" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "TelegramAccount" RENAME CONSTRAINT "TelegramAccount_dealershipId_fkey" TO "TelegramAccount_organizationId_fkey";
ALTER INDEX "TelegramAccount_id_dealershipId_key" RENAME TO "TelegramAccount_id_organizationId_key";
ALTER INDEX "TelegramAccount_dealershipId_idx" RENAME TO "TelegramAccount_organizationId_idx";

ALTER TABLE "TelegramInvite" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "TelegramInvite" RENAME CONSTRAINT "TelegramInvite_dealershipId_fkey" TO "TelegramInvite_organizationId_fkey";
ALTER INDEX "TelegramInvite_dealershipId_idx" RENAME TO "TelegramInvite_organizationId_idx";

ALTER TABLE "Vehicle" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "Vehicle" RENAME CONSTRAINT "Vehicle_dealershipId_fkey" TO "Vehicle_organizationId_fkey";
ALTER INDEX "Vehicle_id_dealershipId_key" RENAME TO "Vehicle_id_organizationId_key";
ALTER INDEX "Vehicle_dealershipId_status_createdAt_idx" RENAME TO "Vehicle_organizationId_status_createdAt_idx";
ALTER INDEX "Vehicle_dealershipId_make_model_idx" RENAME TO "Vehicle_organizationId_make_model_idx";

ALTER TABLE "VehicleImage" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "VehicleImage" RENAME CONSTRAINT "VehicleImage_dealershipId_fkey" TO "VehicleImage_organizationId_fkey";
ALTER INDEX "VehicleImage_id_dealershipId_key" RENAME TO "VehicleImage_id_organizationId_key";
ALTER INDEX "VehicleImage_dealershipId_sha256_idx" RENAME TO "VehicleImage_organizationId_sha256_idx";

ALTER TABLE "ContentJob" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "ContentJob" RENAME CONSTRAINT "ContentJob_dealershipId_fkey" TO "ContentJob_organizationId_fkey";
ALTER INDEX "ContentJob_id_dealershipId_key" RENAME TO "ContentJob_id_organizationId_key";
ALTER INDEX "ContentJob_dealershipId_status_createdAt_idx" RENAME TO "ContentJob_organizationId_status_createdAt_idx";
ALTER INDEX "ContentJob_dealershipId_vehicleId_idx" RENAME TO "ContentJob_organizationId_vehicleId_idx";

ALTER TABLE "ContentAsset" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "ContentAsset" RENAME CONSTRAINT "ContentAsset_dealershipId_fkey" TO "ContentAsset_organizationId_fkey";
ALTER INDEX "ContentAsset_id_dealershipId_key" RENAME TO "ContentAsset_id_organizationId_key";
ALTER INDEX "ContentAsset_dealershipId_vehicleId_idx" RENAME TO "ContentAsset_organizationId_vehicleId_idx";
ALTER INDEX "ContentAsset_dealershipId_status_idx" RENAME TO "ContentAsset_organizationId_status_idx";

ALTER TABLE "VideoPlan" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "VideoPlan" RENAME CONSTRAINT "VideoPlan_dealershipId_fkey" TO "VideoPlan_organizationId_fkey";
ALTER INDEX "VideoPlan_dealershipId_idx" RENAME TO "VideoPlan_organizationId_idx";

ALTER TABLE "Campaign" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "Campaign" RENAME CONSTRAINT "Campaign_dealershipId_fkey" TO "Campaign_organizationId_fkey";
ALTER INDEX "Campaign_id_dealershipId_key" RENAME TO "Campaign_id_organizationId_key";
ALTER INDEX "Campaign_dealershipId_status_idx" RENAME TO "Campaign_organizationId_status_idx";

ALTER TABLE "APIProvider" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "APIProvider" RENAME CONSTRAINT "APIProvider_dealershipId_fkey" TO "APIProvider_organizationId_fkey";
ALTER INDEX "APIProvider_dealershipId_idx" RENAME TO "APIProvider_organizationId_idx";
ALTER INDEX "tenant_APIProvider_dealership_adapter" RENAME TO "tenant_APIProvider_organization_adapter";

ALTER TABLE "APIKeyReference" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "APIKeyReference" RENAME CONSTRAINT "APIKeyReference_dealershipId_fkey" TO "APIKeyReference_organizationId_fkey";
ALTER INDEX "APIKeyReference_dealershipId_idx" RENAME TO "APIKeyReference_organizationId_idx";
ALTER INDEX "APIKeyReference_id_dealershipId_key" RENAME TO "APIKeyReference_id_organizationId_key";

ALTER TABLE "PublishingAccount" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "PublishingAccount" RENAME CONSTRAINT "PublishingAccount_dealershipId_fkey" TO "PublishingAccount_organizationId_fkey";
ALTER INDEX "PublishingAccount_id_dealershipId_key" RENAME TO "PublishingAccount_id_organizationId_key";
ALTER INDEX "PublishingAccount_dealershipId_providerId_platform_external_key" RENAME TO "PublishingAccount_organizationId_providerId_platform_extern_key";

ALTER TABLE "Publication" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "Publication" RENAME CONSTRAINT "Publication_dealershipId_fkey" TO "Publication_organizationId_fkey";
ALTER INDEX "Publication_dealershipId_status_scheduledAt_idx" RENAME TO "Publication_organizationId_status_scheduledAt_idx";

ALTER TABLE "GenerationLog" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "GenerationLog" RENAME CONSTRAINT "GenerationLog_dealershipId_fkey" TO "GenerationLog_organizationId_fkey";
ALTER INDEX "GenerationLog_id_dealershipId_key" RENAME TO "GenerationLog_id_organizationId_key";
ALTER INDEX "GenerationLog_dealershipId_createdAt_idx" RENAME TO "GenerationLog_organizationId_createdAt_idx";

ALTER TABLE "Usage" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "Usage" RENAME CONSTRAINT "Usage_dealershipId_fkey" TO "Usage_organizationId_fkey";
ALTER INDEX "Usage_dealershipId_day_metric_providerAdapter_key" RENAME TO "Usage_organizationId_day_metric_providerAdapter_key";

ALTER TABLE "AuditLog" RENAME COLUMN "dealershipId" TO "organizationId";
ALTER TABLE "AuditLog" RENAME CONSTRAINT "AuditLog_dealershipId_fkey" TO "AuditLog_organizationId_fkey";
ALTER INDEX "AuditLog_dealershipId_createdAt_idx" RENAME TO "AuditLog_organizationId_createdAt_idx";
