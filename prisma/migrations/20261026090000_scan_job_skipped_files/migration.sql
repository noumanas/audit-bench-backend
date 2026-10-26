-- Which files a scan left out of the review, and why (generated, vendor, file limit...).
ALTER TABLE "ScanJob" ADD COLUMN "skippedFiles" JSONB;
