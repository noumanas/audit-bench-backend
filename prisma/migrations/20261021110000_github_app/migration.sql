-- GitHub App: its credentials and the accounts that installed it.
CREATE TABLE "GithubAppConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "appId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "privateKey" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GithubAppConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GithubInstallation" (
    "id" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "repositorySelection" TEXT NOT NULL,
    "userId" TEXT,
    "autoReview" BOOLEAN NOT NULL DEFAULT true,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GithubInstallation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GithubInstallation_userId_idx" ON "GithubInstallation"("userId");

ALTER TABLE "GithubInstallation" ADD CONSTRAINT "GithubInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
