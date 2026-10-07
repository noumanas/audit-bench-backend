-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'expired', 'canceled');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('subscription', 'tdd_engagement', 'other');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "planId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "subscriptionId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "kind" "PaymentKind" NOT NULL DEFAULT 'subscription',
    "method" TEXT,
    "reference" TEXT,
    "payerName" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subscription_status_endsAt_idx" ON "Subscription"("status", "endsAt");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_organizationId_idx" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: every account currently on a paid plan gets its current 30-day
-- term as a subscription at the plan's list price (Enterprise starts at 0 —
-- set its custom price in the Revenue dashboard).
INSERT INTO "Subscription" ("id", "userId", "planId", "amountCents", "startedAt", "endsAt", "status", "source", "updatedAt")
SELECT gen_random_uuid()::text, u."id", u."planId", p."priceMonthlyCents",
       u."planExpiresAt" - INTERVAL '30 days', u."planExpiresAt",
       (CASE WHEN u."planExpiresAt" > NOW() THEN 'active' ELSE 'expired' END)::"SubscriptionStatus",
       'backfill', NOW()
FROM "User" u JOIN "Plan" p ON p."id" = u."planId"
WHERE p."slug" <> 'free' AND u."planExpiresAt" IS NOT NULL;

INSERT INTO "Subscription" ("id", "organizationId", "planId", "amountCents", "startedAt", "endsAt", "status", "source", "updatedAt")
SELECT gen_random_uuid()::text, o."id", o."planId", p."priceMonthlyCents",
       o."planExpiresAt" - INTERVAL '30 days', o."planExpiresAt",
       (CASE WHEN o."planExpiresAt" > NOW() THEN 'active' ELSE 'expired' END)::"SubscriptionStatus",
       'backfill', NOW()
FROM "Organization" o JOIN "Plan" p ON p."id" = o."planId"
WHERE p."slug" <> 'free' AND o."planExpiresAt" IS NOT NULL;
