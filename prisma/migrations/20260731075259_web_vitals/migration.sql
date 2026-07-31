-- CreateEnum
CREATE TYPE "WebVitalRating" AS ENUM ('good', 'needs_improvement', 'poor');

-- CreateTable
CREATE TABLE "WebVital" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "rating" "WebVitalRating" NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebVital_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebVital_name_createdAt_idx" ON "WebVital"("name", "createdAt");

-- CreateIndex
CREATE INDEX "WebVital_path_idx" ON "WebVital"("path");
