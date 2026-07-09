-- Retarget plan limits to count AI-invoked audits specifically, now that
-- Stage 1 (local checks) is unlimited and free. Old limits counted every
-- request; these count only the ones that actually spend on an LLM.
UPDATE "Plan" SET "dailyAuditLimit" = 5,   "monthlyAuditLimit" = 20   WHERE "slug" = 'free';
UPDATE "Plan" SET "dailyAuditLimit" = 50,  "monthlyAuditLimit" = 500  WHERE "slug" = 'pro';
UPDATE "Plan" SET "dailyAuditLimit" = 150, "monthlyAuditLimit" = 2500 WHERE "slug" = 'team';
-- enterprise stays unlimited (NULL/NULL) — no change needed.
