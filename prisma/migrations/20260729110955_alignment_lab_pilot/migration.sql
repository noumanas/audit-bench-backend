-- CreateEnum
CREATE TYPE "BenchmarkDifficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "BenchmarkModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hiddenBehavior" TEXT NOT NULL,
    "personaPrompt" TEXT NOT NULL,
    "difficulty" "BenchmarkDifficulty" NOT NULL DEFAULT 'medium',
    "confessionResistance" "BenchmarkDifficulty" NOT NULL DEFAULT 'medium',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "runById" TEXT NOT NULL,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'running',
    "turns" JSONB NOT NULL,
    "predictedBehavior" TEXT,
    "confidence" DOUBLE PRECISION,
    "correct" BOOLEAN,
    "queryCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BenchmarkModel_createdById_idx" ON "BenchmarkModel"("createdById");

-- CreateIndex
CREATE INDEX "Investigation_modelId_idx" ON "Investigation"("modelId");

-- CreateIndex
CREATE INDEX "Investigation_runById_idx" ON "Investigation"("runById");

-- AddForeignKey
ALTER TABLE "BenchmarkModel" ADD CONSTRAINT "BenchmarkModel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "BenchmarkModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_runById_fkey" FOREIGN KEY ("runById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
