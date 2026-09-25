-- Fase 12: notificaciones. La tabla NotificationOutbox no se había usado hasta ahora (está vacía en
-- todos los entornos), por eso la columna obligatoria "audience" se añade sin valor por defecto.
-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('CUSTOMER', 'BUSINESS');

-- AlterEnum
ALTER TYPE "NotificationStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "NotificationOutbox" ADD COLUMN     "audience" "NotificationAudience" NOT NULL;

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_bookingId_idx" ON "NotificationOutbox"("tenantId", "bookingId");

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_createdAt_idx" ON "NotificationOutbox"("tenantId", "createdAt" DESC);
