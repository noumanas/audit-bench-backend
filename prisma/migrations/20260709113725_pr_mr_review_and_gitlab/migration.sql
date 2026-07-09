-- CreateEnum
CREATE TYPE "ScanSourceType" AS ENUM ('zip', 'github_repo', 'github_pr', 'gitlab_repo', 'gitlab_mr');

-- AlterTable
ALTER TABLE "ScanJob" ADD COLUMN     "pullRequestUrl" TEXT,
ADD COLUMN     "sourceType" "ScanSourceType" NOT NULL DEFAULT 'zip';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gitlabToken" TEXT,
ADD COLUMN     "gitlabUsername" TEXT;
