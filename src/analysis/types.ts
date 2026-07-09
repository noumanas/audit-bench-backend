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
