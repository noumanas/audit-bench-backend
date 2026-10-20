import { ScannedFile } from '../analysis/types';
import { PrSnapshot } from '../common/merge-readiness';
import { LineRange } from '../common/diff-ranges';

export interface GithubRepoSummary {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface GithubPrSummary {
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
  draft: boolean;
  updatedAt: string;
  htmlUrl: string;
}

export interface GithubPrFile {
  path: string;
  content: string;
  changedRanges: LineRange[];
  status: 'added' | 'modified' | 'renamed';
}

export interface GithubPrDetails {
  files: GithubPrFile[];
  headSha: string;
  url: string;
  headRef: string;
  baseRef: string;
  /** Merge state and CI checks — only when fetchPrFiles is asked for it. */
  snapshot?: PrSnapshot;
  /** The repository at the PR's head commit, for related-code context — only when asked for, and the repo is small enough. */
  repoFiles?: ScannedFile[];
}
