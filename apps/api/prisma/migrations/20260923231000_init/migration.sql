-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('PUBLIC_WEB', 'ADMIN', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'PUBLIC', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "defaultCountryCode" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "locale" TEXT NOT NULL,
    "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "defaultBookingStatus" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "bookingLeadMinutes" INTEGER NOT NULL DEFAULT 60,
    "bookingHorizonDays" INTEGER NOT NULL DEFAULT 60,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "mapsUrl" TEXT,
    "whatsapp" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Professional" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "displayName" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "photoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Professional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalService" (
    "tenantId" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalService_pkey" PRIMARY KEY ("professionalId","serviceId")
);

-- CreateTable
CREATE TABLE "WorkingHour" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "startMinute" SMALLINT NOT NULL,
    "endMinute" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkingHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeBlock" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "professionalId" UUID,
    "locationId" UUID,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TimeBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "serviceNameSnapshot" TEXT NOT NULL,
    "priceCentsSnapshot" INTEGER NOT NULL,
    "durationMinutesSnapshot" INTEGER NOT NULL,
    "currencySnapshot" CHAR(3) NOT NULL,
    "customerNotes" TEXT,
    "source" "BookingSource" NOT NULL,
    "createdByUserId" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "manageTokenHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bookingId" UUID,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Location_tenantId_idx" ON "Location"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_tenantId_id_key" ON "Location"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Professional_userId_key" ON "Professional"("userId");

-- CreateIndex
CREATE INDEX "Professional_tenantId_idx" ON "Professional"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Professional_tenantId_id_key" ON "Professional"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Professional_tenantId_userId_key" ON "Professional"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "Service_tenantId_idx" ON "Service"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_tenantId_id_key" ON "Service"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ProfessionalService_tenantId_serviceId_idx" ON "ProfessionalService"("tenantId", "serviceId");

-- CreateIndex
CREATE INDEX "WorkingHour_tenantId_professionalId_weekday_idx" ON "WorkingHour"("tenantId", "professionalId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingHour_tenantId_id_key" ON "WorkingHour"("tenantId", "id");

-- CreateIndex
CREATE INDEX "TimeBlock_tenantId_professionalId_startAt_idx" ON "TimeBlock"("tenantId", "professionalId", "startAt");

-- CreateIndex
CREATE INDEX "TimeBlock_tenantId_startAt_idx" ON "TimeBlock"("tenantId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "TimeBlock_tenantId_id_key" ON "TimeBlock"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_id_key" ON "Customer"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_phoneE164_key" ON "Customer"("tenantId", "phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_manageTokenHash_key" ON "Booking"("manageTokenHash");

-- CreateIndex
CREATE INDEX "Booking_tenantId_professionalId_startAt_idx" ON "Booking"("tenantId", "professionalId", "startAt");

-- CreateIndex
CREATE INDEX "Booking_tenantId_startAt_idx" ON "Booking"("tenantId", "startAt");

-- CreateIndex
CREATE INDEX "Booking_tenantId_customerId_idx" ON "Booking"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_tenantId_id_key" ON "Booking"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON "AuditLog"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Professional" ADD CONSTRAINT "Professional_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Professional" ADD CONSTRAINT "Professional_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalService" ADD CONSTRAINT "ProfessionalService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalService" ADD CONSTRAINT "ProfessionalService_tenantId_professionalId_fkey" FOREIGN KEY ("tenantId", "professionalId") REFERENCES "Professional"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalService" ADD CONSTRAINT "ProfessionalService_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHour" ADD CONSTRAINT "WorkingHour_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHour" ADD CONSTRAINT "WorkingHour_tenantId_professionalId_fkey" FOREIGN KEY ("tenantId", "professionalId") REFERENCES "Professional"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHour" ADD CONSTRAINT "WorkingHour_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "Location"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_tenantId_professionalId_fkey" FOREIGN KEY ("tenantId", "professionalId") REFERENCES "Professional"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "Location"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "Location"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_professionalId_fkey" FOREIGN KEY ("tenantId", "professionalId") REFERENCES "Professional"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_actorUserId_fkey" FOREIGN KEY ("tenantId", "actorUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "Booking"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
