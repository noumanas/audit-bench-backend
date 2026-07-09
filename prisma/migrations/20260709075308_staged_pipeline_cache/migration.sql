-- AlterTable
ALTER TABLE "Audit" ADD COLUMN     "aiInvoked" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "fromCache" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stage1" JSONB;

-- AlterTable
ALTER TABLE "ScanFile" ADD COLUMN     "aiInvoked" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "fromCache" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stage1" JSONB;

-- AlterTable
ALTER TABLE "ScanJob" ADD COLUMN     "filesAiSkipped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "filesFromCache" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AuditCache" (
    "id" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "stage1" JSONB,
    "aiInvoked" BOOLEAN NOT NULL DEFAULT false,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditCache_contentHash_key" ON "AuditCache"("contentHash");
