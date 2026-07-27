-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "maxRepositories" INTEGER;

-- Free plan can now scan repositories (previously blocked outright), but
-- only one, for the lifetime of the account — paid plans stay unlimited
-- (NULL). See QuotaService.assertCanScanNewRepository.
UPDATE "Plan" SET "repositoryScan" = true, "maxRepositories" = 1 WHERE "slug" = 'free';
