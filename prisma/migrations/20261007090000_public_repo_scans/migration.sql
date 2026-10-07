-- Public, shareable repository scans (anonymous scans from the marketing
-- site, and owners sharing their own scans).
ALTER TABLE "ScanJob" ADD COLUMN "shareId" TEXT;
ALTER TABLE "ScanJob" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScanJob" ADD COLUMN "localOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScanJob" ADD COLUMN "requesterIpHash" TEXT;
CREATE UNIQUE INDEX "ScanJob_shareId_key" ON "ScanJob"("shareId");
CREATE INDEX "ScanJob_requesterIpHash_createdAt_idx" ON "ScanJob"("requesterIpHash", "createdAt");
