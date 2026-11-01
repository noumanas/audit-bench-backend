-- AlterTable
ALTER TABLE "ScanJob" ADD COLUMN     "prRepeatStats" JSONB;

-- CreateTable
CREATE TABLE "ReviewSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "severeMinConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "deepNesting" INTEGER NOT NULL DEFAULT 4,
    "veryHighComplexity" INTEGER NOT NULL DEFAULT 25,
    "optionalSuggestions" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSettings_organizationId_key" ON "ReviewSettings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSettings_userId_key" ON "ReviewSettings"("userId");

-- AddForeignKey
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

