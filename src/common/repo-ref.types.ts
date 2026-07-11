/**
 * Persisted on ScanJob.repoRef for github_repo / gitlab_repo scans — what
 * FixService needs to branch off the scanned ref and open a PR/MR once the
 * user commits a fix from the web editor.
 */
export type RepoRef =
  | { kind: 'github'; owner: string; repo: string; ref: string; defaultBranch: string }
  | { kind: 'gitlab'; projectId: number; ref: string; defaultBranch: string };
