-- PR/MR reviews: keep changed ranges for re-posting, and record whether posting worked.
ALTER TABLE "ScanJob" ADD COLUMN "changedRanges" JSONB;
ALTER TABLE "ScanJob" ADD COLUMN "prPublishedAt" TIMESTAMP(3);
ALTER TABLE "ScanJob" ADD COLUMN "prPublishError" TEXT;
