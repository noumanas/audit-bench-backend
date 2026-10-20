-- Bitbucket Cloud: repository scans, pull request reviews, and a connected token.
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScanSourceType" ADD VALUE 'bitbucket_repo';
ALTER TYPE "ScanSourceType" ADD VALUE 'bitbucket_pr';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bitbucketToken" TEXT,
ADD COLUMN     "bitbucketUsername" TEXT;

