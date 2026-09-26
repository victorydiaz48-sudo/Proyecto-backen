-- Phase 3d: the barbershop vertical module's own tables (scaffolded to
-- prove a second vertical needs no core schema changes — see
-- packages/verticals/barbershop/prisma/schema.prisma). Purely additive.
--
-- CreateTable/CreateIndex/AddForeignKey below are exactly what
-- `prisma migrate diff` proposed (trustworthy for a genuine additive
-- change, unlike a rename — see packages/database/README.md rule 7); the
-- two tenant_* composite foreign keys are hand-added, mirroring
-- tenant_Vehicle_primaryImage/tenant_VehicleImage_vehicle, since Prisma's
-- schema language cannot express them (rule 3).

-- CreateTable
CREATE TABLE "Haircut" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "style" TEXT,
    "color" TEXT,
    "provenance" JSONB NOT NULL,
    "primaryPhotoId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Haircut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaircutPhoto" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "haircutId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "analysis" JSONB,
    "analyzedBy" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaircutPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Haircut_primaryPhotoId_key" ON "Haircut"("primaryPhotoId");

-- CreateIndex
CREATE INDEX "Haircut_organizationId_createdAt_idx" ON "Haircut"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Haircut_id_organizationId_key" ON "Haircut"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "HaircutPhoto_storageKey_key" ON "HaircutPhoto"("storageKey");

-- CreateIndex
CREATE INDEX "HaircutPhoto_organizationId_sha256_idx" ON "HaircutPhoto"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "HaircutPhoto_haircutId_idx" ON "HaircutPhoto"("haircutId");

-- CreateIndex
CREATE UNIQUE INDEX "HaircutPhoto_id_organizationId_key" ON "HaircutPhoto"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "Haircut" ADD CONSTRAINT "Haircut_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HaircutPhoto" ADD CONSTRAINT "HaircutPhoto_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HaircutPhoto" ADD CONSTRAINT "HaircutPhoto_haircutId_fkey" FOREIGN KEY ("haircutId") REFERENCES "Haircut"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TENANT BOUNDARY: composite (childId, organizationId) foreign keys Prisma cannot express.
ALTER TABLE "Haircut" ADD CONSTRAINT "tenant_Haircut_primaryPhoto"
  FOREIGN KEY ("primaryPhotoId", "organizationId") REFERENCES "HaircutPhoto"("id", "organizationId") ON DELETE SET NULL ("primaryPhotoId");
ALTER TABLE "HaircutPhoto" ADD CONSTRAINT "tenant_HaircutPhoto_haircut"
  FOREIGN KEY ("haircutId", "organizationId") REFERENCES "Haircut"("id", "organizationId") ON DELETE CASCADE;
