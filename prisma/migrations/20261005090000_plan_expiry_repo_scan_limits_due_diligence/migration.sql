-- Per-plan monthly AI repository-scan limit and the Enterprise-only due
-- diligence gate.
ALTER TABLE "Plan" ADD COLUMN "monthlyRepoScanLimit" INTEGER;
ALTER TABLE "Plan" ADD COLUMN "dueDiligence" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Plan" SET "monthlyRepoScanLimit" = 1  WHERE "slug" = 'free';
UPDATE "Plan" SET "monthlyRepoScanLimit" = 3  WHERE "slug" = 'pro';
UPDATE "Plan" SET "monthlyRepoScanLimit" = 20 WHERE "slug" = 'team';
-- enterprise stays unlimited (NULL)
UPDATE "Plan" SET "dueDiligence" = true WHERE "slug" = 'enterprise';

-- Paid plans now expire 30 days after approval and fall back to Free.
ALTER TABLE "User" ADD COLUMN "planExpiresAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "planExpiresAt" TIMESTAMP(3);

-- Existing paid accounts get a fresh 30 days from this migration rather
-- than being downgraded on the spot.
UPDATE "User" SET "planExpiresAt" = NOW() + INTERVAL '30 days'
  WHERE "planId" IN (SELECT "id" FROM "Plan" WHERE "slug" <> 'free');
UPDATE "Organization" SET "planExpiresAt" = NOW() + INTERVAL '30 days'
  WHERE "planId" IN (SELECT "id" FROM "Plan" WHERE "slug" <> 'free');
