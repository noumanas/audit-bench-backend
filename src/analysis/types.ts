import { LineRange } from '../common/diff-ranges';

export interface ScannedFile {
  /** Path relative to the repo root, forward-slash separated. */
  path: string;
  content: string;
  /** Set for a PR/MR review — scopes the audit to just these changed lines. */
  changedRanges?: LineRange[];
}

export interface DependencyGraphResult {
  graph: Record<string, string[]>;
  circular: string[][];
}

export interface DuplicateGroup {
  linesOfCode: number;
  occurrences: { path: string; startLine: number; endLine: number }[];
}

export interface SecretFinding {
  path: string;
  line: number;
  rule: string;
  snippet: string;
}

/**
 * Per-contributor commit activity for a github_repo/gitlab_repo scan — see
 * GithubService.fetchContributorStats / GitlabService.fetchContributorStats.
 * Sourced from each provider's own aggregated stats endpoint rather than a
 * local `git log` walk, so it needs no git clone or history download —
 * consistent with the rest of this app's provider integrations, which are
 * all REST calls against the hosted API, never a local git binary.
 */
export interface ContributorStat {
  /** Provider login/username when available, otherwise the commit author's display name. */
  author: string;
  email?: string;
  commits: number;
  additions: number;
  deletions: number;
  /** ISO timestamp of this contributor's most recent commit, or null if the provider didn't report one. */
  lastCommitAt: string | null;
}
