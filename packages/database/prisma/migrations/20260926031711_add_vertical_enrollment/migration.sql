-- Adds VerticalEnrollment: which vertical module an organization runs, and
-- that module's own config (see packages/verticals/core). Purely additive.

-- CreateTable
CREATE TABLE "VerticalEnrollment" (
    "organizationId" UUID NOT NULL,
    "vertical" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerticalEnrollment_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "VerticalEnrollment" ADD CONSTRAINT "VerticalEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
