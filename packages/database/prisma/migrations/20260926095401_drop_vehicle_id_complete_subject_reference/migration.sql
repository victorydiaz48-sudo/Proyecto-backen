-- Phase 3c: drops the now-redundant vehicleId columns from
-- ContentJob/ContentAsset/VideoPlan, now that every write path
-- (packages/database/src/ops/jobs.ts, apps/worker/src/process-content-job.ts,
-- apps/telegram/src/bot.ts) goes through subjectType/subjectId instead
-- (docs/phase-3-design.md §3.2, §14 3c). subjectType/subjectId are made
-- required, since they have been populated on every write since Phase 3b.
--
-- This is the one sanctioned exception to "never drop a tenant_* constraint"
-- (packages/database/README.md rule 2): tenant_ContentJob_vehicle,
-- tenant_ContentAsset_vehicle and tenant_VideoPlan_vehicle guarded vehicleId
-- itself, which no longer exists. subjectType/subjectId are a deliberate,
-- documented trade for app-enforced (not DB-enforced) referential integrity
-- — there is no replacement composite FK to add.
--
-- Verified with `prisma migrate diff` against a disposable clone (see
-- packages/database/README.md rule 7); every other tenant_* constraint drop
-- that diff proposes is the same pre-existing noise from Prisma not knowing
-- about hand-written composite FKs, and is excluded here as usual.

-- Real (Prisma-managed) foreign keys on the columns being dropped.
ALTER TABLE "ContentJob" DROP CONSTRAINT "ContentJob_vehicleId_fkey";
ALTER TABLE "ContentAsset" DROP CONSTRAINT "ContentAsset_vehicleId_fkey";
ALTER TABLE "VideoPlan" DROP CONSTRAINT "VideoPlan_vehicleId_fkey";

-- Sanctioned exception: these guarded vehicleId, which is being dropped.
ALTER TABLE "ContentJob" DROP CONSTRAINT "tenant_ContentJob_vehicle";
ALTER TABLE "ContentAsset" DROP CONSTRAINT "tenant_ContentAsset_vehicle";
ALTER TABLE "VideoPlan" DROP CONSTRAINT "tenant_VideoPlan_vehicle";

-- Indexes that referenced vehicleId, replaced by subjectType/subjectId ones below.
DROP INDEX "ContentJob_organizationId_vehicleId_idx";
DROP INDEX "ContentAsset_organizationId_vehicleId_idx";

ALTER TABLE "ContentJob" DROP COLUMN "vehicleId";
ALTER TABLE "ContentJob" ALTER COLUMN "subjectType" SET NOT NULL;
ALTER TABLE "ContentJob" ALTER COLUMN "subjectId" SET NOT NULL;

ALTER TABLE "ContentAsset" DROP COLUMN "vehicleId";
ALTER TABLE "ContentAsset" ALTER COLUMN "subjectType" SET NOT NULL;
ALTER TABLE "ContentAsset" ALTER COLUMN "subjectId" SET NOT NULL;

ALTER TABLE "VideoPlan" DROP COLUMN "vehicleId";
ALTER TABLE "VideoPlan" ALTER COLUMN "subjectType" SET NOT NULL;
ALTER TABLE "VideoPlan" ALTER COLUMN "subjectId" SET NOT NULL;

CREATE INDEX "ContentJob_organizationId_subjectType_subjectId_idx" ON "ContentJob"("organizationId", "subjectType", "subjectId");
CREATE INDEX "ContentAsset_organizationId_subjectType_subjectId_idx" ON "ContentAsset"("organizationId", "subjectType", "subjectId");
