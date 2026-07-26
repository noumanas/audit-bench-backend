-- AlterTable
ALTER TABLE "Audit" ADD COLUMN     "findingStatuses" JSONB;

-- AlterTable
ALTER TABLE "ScanFile" ADD COLUMN     "findingStatuses" JSONB;
