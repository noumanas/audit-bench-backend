-- One-off cleanup: delete accounts registered with @example.com addresses.
-- example.com is reserved for documentation and can never receive mail, so
-- these are test signups (e.g. qa-1793229469377-74553b@example.com). New
-- ones are already refused at signup (src/auth/email-domain.ts).
--
-- Same rules as the admin "Delete user" action:
--   * super admins are never deleted;
--   * a team owner whose team has members outside this cleanup is kept, so
--     no real team is left without an owner;
--   * a team owned and used only by these accounts is deleted with them.
-- Their audits, scans, reports, rules and tokens cascade; payments keep
-- their history with the user cleared. This cannot be undone.

CREATE TEMP TABLE "_example_users" ON COMMIT DROP AS
SELECT "id", "organizationId", "orgRole"
FROM "User"
WHERE lower("email") LIKE '%@example.com'
  AND "role" <> 'super_admin';

-- Keep owners of a team that still has someone else in it.
DELETE FROM "_example_users" t
WHERE t."orgRole" = 'owner'
  AND t."organizationId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "User" u
    WHERE u."organizationId" = t."organizationId"
      AND u."id" NOT IN (SELECT "id" FROM "_example_users")
  );

-- References that would otherwise block deleting a user.
DELETE FROM "OrganizationInvite" WHERE "invitedById" IN (SELECT "id" FROM "_example_users");
UPDATE "PlanRequest" SET "reviewedById" = NULL WHERE "reviewedById" IN (SELECT "id" FROM "_example_users");

-- Teams owned only by these accounts go with them.
CREATE TEMP TABLE "_example_orgs" ON COMMIT DROP AS
SELECT DISTINCT "organizationId" AS "id"
FROM "_example_users"
WHERE "orgRole" = 'owner' AND "organizationId" IS NOT NULL;

UPDATE "User" SET "organizationId" = NULL, "orgRole" = NULL WHERE "organizationId" IN (SELECT "id" FROM "_example_orgs");
DELETE FROM "Organization" WHERE "id" IN (SELECT "id" FROM "_example_orgs");

DELETE FROM "User" WHERE "id" IN (SELECT "id" FROM "_example_users");
