-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gitlabRefreshToken" TEXT,
ADD COLUMN     "gitlabTokenExpiresAt" TIMESTAMP(3);

