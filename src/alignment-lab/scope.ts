import { WorkspaceActor } from '../common/workspace-scope';

/**
 * Same rule as workspaceWhere (common/workspace-scope.ts), just spelled out
 * for these models' own owner-field names (createdById / runById, not
 * userId) — workspaceWhere itself assumes a `userId` column, which
 * BenchmarkModel/Investigation don't have.
 */
export function alignmentLabScopeWhere(actor: WorkspaceActor, ownerField: 'createdById' | 'runById') {
  return actor.organizationId
    ? { OR: [{ organizationId: actor.organizationId }, { [ownerField]: actor.id, organizationId: null }] }
    : { [ownerField]: actor.id };
}
