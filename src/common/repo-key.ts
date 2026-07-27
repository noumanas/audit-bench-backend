import { RepoRef } from './repo-ref.types';
import { PrContext } from '../pr-feedback/pr-feedback.types';

export interface RepoKeyInput {
  sourceName: string;
  repoRef?: unknown;
  prContext?: unknown;
}

/**
 * Canonical identity for "which repository" a scan targeted — used to count
 * distinct repositories against a plan's maxRepositories cap (see
 * QuotaService.assertCanScanNewRepository). A PR/MR review and a full-repo
 * scan of the same repository resolve to the same key, so reviewing PRs
 * against your one allowed repo never counts as a second one.
 *
 * Zip uploads have no identity beyond the archive's own filename, so each
 * one is its own key — the best signal available for that source.
 */
export function deriveRepoKey(input: RepoKeyInput): string {
  const repoRef = input.repoRef as RepoRef | null | undefined;
  if (repoRef?.kind === 'github') return `github:${repoRef.owner}/${repoRef.repo}`;
  if (repoRef?.kind === 'gitlab') return `gitlab:${repoRef.projectId}`;

  const prContext = input.prContext as PrContext | null | undefined;
  if (prContext?.kind === 'github') return `github:${prContext.owner}/${prContext.repo}`;
  if (prContext?.kind === 'gitlab') return `gitlab:${prContext.projectId}`;

  return `zip:${input.sourceName}`;
}
