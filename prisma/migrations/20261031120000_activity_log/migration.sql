-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('signup', 'login', 'login_failed', 'plan_requested', 'plan_approved', 'plan_rejected');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationsSeenAt" TIMESTAMP(3),
ADD COLUMN     "signupCampaign" TEXT,
ADD COLUMN     "signupCity" TEXT,
ADD COLUMN     "signupCountry" TEXT,
ADD COLUMN     "signupMethod" TEXT,
ADD COLUMN     "signupRegion" TEXT,
ADD COLUMN     "signupSource" TEXT;

-- AlterTable
ALTER TABLE "OAuthLoginCode" ADD COLUMN     "isNewUser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provider" TEXT;

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "method" TEXT,
    "ip" TEXT,
    "countryCode" TEXT,
    "region" TEXT,
    "city" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_type_createdAt_idx" ON "ActivityLog"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

