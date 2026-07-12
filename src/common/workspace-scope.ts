export interface WorkspaceActor {
  id: string;
  organizationId: string | null;
}

/**
 * Scopes an Audit/ScanJob query to "everything the actor's org has run,
 * plus the actor's own pre-org history" — the org half makes the whole team
 * see each other's work; the userId-with-null-org half is what keeps a
 * member's audits from before they joined a team private to them alone
 * (never migrated in, never shown to teammates). Outside any org, this is
 * just the plain per-user scope it always was.
 */
export function workspaceWhere(actor: WorkspaceActor) {
  return actor.organizationId
    ? { OR: [{ organizationId: actor.organizationId }, { userId: actor.id, organizationId: null }] }
    : { userId: actor.id };
}

/** Same rule as `workspaceWhere`, applied to an already-loaded row instead of a query. */
export function canViewResource(
  actor: WorkspaceActor,
  resource: { userId: string; organizationId: string | null },
): boolean {
  if (actor.organizationId && resource.organizationId === actor.organizationId) return true;
  return resource.userId === actor.id && resource.organizationId === null;
}
