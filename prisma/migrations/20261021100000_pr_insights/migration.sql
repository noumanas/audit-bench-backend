-- AI walkthrough, merge risk and pre-merge checks for a PR review.
ALTER TABLE "ScanJob" ADD COLUMN "prInsights" JSONB;
