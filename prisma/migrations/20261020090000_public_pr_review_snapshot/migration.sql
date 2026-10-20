-- Free public PR reviews: GitHub state, merge conflicts and CI checks at review time.
ALTER TABLE "ScanJob" ADD COLUMN "prSnapshot" JSONB;
