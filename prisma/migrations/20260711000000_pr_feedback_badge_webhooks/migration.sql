-- AlterTable
ALTER TABLE "ScanJob" ADD COLUMN     "prContext" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "badgeToken" TEXT;

-- CreateTable
CREATE TABLE "WebhookConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "repoIdentifier" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookConfig_provider_repoIdentifier_key" ON "WebhookConfig"("provider", "repoIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "User_badgeToken_key" ON "User"("badgeToken");

-- AddForeignKey
ALTER TABLE "WebhookConfig" ADD CONSTRAINT "WebhookConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

