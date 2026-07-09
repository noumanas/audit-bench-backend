-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthlyCents" INTEGER NOT NULL DEFAULT 0,
    "dailyAuditLimit" INTEGER,
    "monthlyAuditLimit" INTEGER,
    "repositoryScan" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "planId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed default plans
INSERT INTO "Plan" ("id", "slug", "name", "priceMonthlyCents", "dailyAuditLimit", "monthlyAuditLimit", "repositoryScan")
VALUES
  (gen_random_uuid(), 'free', 'Free', 0, 5, 50, false),
  (gen_random_uuid(), 'pro', 'Pro', 2900, 100, 2000, true),
  (gen_random_uuid(), 'team', 'Team', 9900, 300, 6000, true),
  (gen_random_uuid(), 'enterprise', 'Enterprise', 0, NULL, NULL, true);

-- Existing audits/scans predate user accounts — attach them to a placeholder
-- legacy account (password unusable: it's not a valid bcrypt hash) rather
-- than dropping historical data.
INSERT INTO "User" ("id", "email", "passwordHash", "name", "planId", "createdAt")
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'legacy@local',
  'no-login',
  'Legacy data (pre-auth)',
  (SELECT "id" FROM "Plan" WHERE "slug" = 'enterprise'),
  CURRENT_TIMESTAMP
);

-- AlterTable
ALTER TABLE "Audit" ADD COLUMN "userId" TEXT;
UPDATE "Audit" SET "userId" = '00000000-0000-0000-0000-000000000000' WHERE "userId" IS NULL;
ALTER TABLE "Audit" ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ScanJob" ADD COLUMN "userId" TEXT;
UPDATE "ScanJob" SET "userId" = '00000000-0000-0000-0000-000000000000' WHERE "userId" IS NULL;
ALTER TABLE "ScanJob" ALTER COLUMN "userId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Audit_userId_idx" ON "Audit"("userId");

-- CreateIndex
CREATE INDEX "ScanJob_userId_idx" ON "ScanJob"("userId");

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
