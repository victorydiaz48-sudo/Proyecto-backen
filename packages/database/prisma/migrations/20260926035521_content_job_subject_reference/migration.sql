-- Sub-phase 3b: introduces the polymorphic subjectType/subjectId reference
-- (docs/phase-3-design.md §3.2) alongside the existing vehicleId columns.
-- Additive only — vehicleId stays the real foreign key for now; dropping it
-- is 3c's job, once every write path goes through subjectType/subjectId.
-- Backfilled for every existing row as "dealership.vehicle" + vehicleId,
-- since dealership is (so far) the only vertical that has ever created jobs.

ALTER TABLE "ContentJob" ADD COLUMN "subjectType" TEXT;
ALTER TABLE "ContentJob" ADD COLUMN "subjectId" UUID;
ALTER TABLE "ContentAsset" ADD COLUMN "subjectType" TEXT;
ALTER TABLE "ContentAsset" ADD COLUMN "subjectId" UUID;
ALTER TABLE "VideoPlan" ADD COLUMN "subjectType" TEXT;
ALTER TABLE "VideoPlan" ADD COLUMN "subjectId" UUID;

UPDATE "ContentJob" SET "subjectType" = 'dealership.vehicle', "subjectId" = "vehicleId";
UPDATE "ContentAsset" SET "subjectType" = 'dealership.vehicle', "subjectId" = "vehicleId";
UPDATE "VideoPlan" SET "subjectType" = 'dealership.vehicle', "subjectId" = "vehicleId";
