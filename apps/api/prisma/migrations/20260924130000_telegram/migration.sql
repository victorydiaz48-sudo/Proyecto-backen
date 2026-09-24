-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramLinkExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "telegramLinkTokenHash" TEXT,
ADD COLUMN     "telegramLinkedAt" TIMESTAMPTZ(3);
-- CreateIndex
CREATE UNIQUE INDEX "Tenant_telegramLinkTokenHash_key" ON "Tenant"("telegramLinkTokenHash");
