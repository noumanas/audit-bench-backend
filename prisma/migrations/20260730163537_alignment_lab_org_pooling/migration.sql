-- AlterTable
ALTER TABLE "BenchmarkModel" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Investigation" ADD COLUMN     "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "BenchmarkModel_organizationId_idx" ON "BenchmarkModel"("organizationId");

-- CreateIndex
CREATE INDEX "Investigation_organizationId_idx" ON "Investigation"("organizationId");

-- AddForeignKey
ALTER TABLE "BenchmarkModel" ADD CONSTRAINT "BenchmarkModel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
