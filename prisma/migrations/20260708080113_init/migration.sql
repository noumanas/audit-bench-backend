-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('pass', 'needs_work', 'do_not_ship');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "language" TEXT,
    "provider" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "codeSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL,
    "framework" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "filesScanned" INTEGER NOT NULL DEFAULT 0,
    "verdict" "Verdict",
    "summary" TEXT,
    "dependencyGraph" JSONB,
    "circularImports" JSONB,
    "deadCode" JSONB,
    "duplicates" JSONB,
    "secrets" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanFile" (
    "id" TEXT NOT NULL,
    "scanJobId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "language" TEXT,
    "verdict" "Verdict",
    "findings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanFile_scanJobId_idx" ON "ScanFile"("scanJobId");

-- AddForeignKey
ALTER TABLE "ScanFile" ADD CONSTRAINT "ScanFile_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
