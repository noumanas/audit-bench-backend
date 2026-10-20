-- Team review rules and the feedback that teaches learned ones.
-- CreateTable
CREATE TABLE "ReviewRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "repo" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "fingerprint" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "evidence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "repo" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewRule_userId_idx" ON "ReviewRule"("userId");

-- CreateIndex
CREATE INDEX "ReviewRule_organizationId_idx" ON "ReviewRule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FindingFeedback_sourceRef_key" ON "FindingFeedback"("sourceRef");

-- CreateIndex
CREATE INDEX "FindingFeedback_userId_repo_fingerprint_idx" ON "FindingFeedback"("userId", "repo", "fingerprint");

-- CreateIndex
CREATE INDEX "FindingFeedback_organizationId_repo_fingerprint_idx" ON "FindingFeedback"("organizationId", "repo", "fingerprint");

-- AddForeignKey
ALTER TABLE "ReviewRule" ADD CONSTRAINT "ReviewRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "FindingFeedback" ADD CONSTRAINT "FindingFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
