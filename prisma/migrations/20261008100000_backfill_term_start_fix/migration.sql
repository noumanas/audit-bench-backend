-- An account renewed before the revenue ledger existed has a plan running
-- more than 30 days out, so its backfilled term started in the future and
-- left a gap in MRR. Start such terms when they were backfilled instead.
UPDATE "Subscription"
SET "startedAt" = "createdAt"
WHERE "source" = 'backfill' AND "startedAt" > "createdAt";
