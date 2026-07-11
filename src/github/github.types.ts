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
}
