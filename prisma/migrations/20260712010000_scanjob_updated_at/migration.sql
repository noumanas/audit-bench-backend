-- AlterTable
-- DEFAULT CURRENT_TIMESTAMP backfills existing rows to satisfy NOT NULL;
-- Prisma's `@updatedAt` handles bumping it on every future write regardless.
ALTER TABLE "ScanJob" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "ScanJob_status_updatedAt_idx" ON "ScanJob"("status", "updatedAt");
