-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "alignmentLabEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monthlyInvestigationLimit" INTEGER;

-- Alignment Lab ships as a Team/Enterprise feature, not Free/Pro (both stay
-- at the false/NULL defaults above) — mirrors repositoryScan's existing
-- free-vs-paid split, one tier further up.
UPDATE "Plan" SET "alignmentLabEnabled" = true, "monthlyInvestigationLimit" = 20 WHERE "slug" = 'team';
UPDATE "Plan" SET "alignmentLabEnabled" = true, "monthlyInvestigationLimit" = NULL WHERE "slug" = 'enterprise';
