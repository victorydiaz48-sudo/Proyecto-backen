-- Telegram source of a content job (file to ingest + originating message).
-- NOTE: Prisma also generated DROP statements for the hand-written tenant_*
-- constraints and APIKeyReference_id_dealershipId_key; they were removed on
-- purpose (see packages/database/README.md).
ALTER TABLE "ContentJob" ADD COLUMN "telegramFileId" TEXT,
ADD COLUMN "telegramMessageId" INTEGER;
