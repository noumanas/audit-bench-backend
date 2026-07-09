import { LineRange } from '../common/diff-ranges';
export interface ScannedFile {
    path: string;
    content: string;
    changedRanges?: LineRange[];
}
export interface DependencyGraphResult {
    graph: Record<string, string[]>;
    circular: string[][];
}
export interface DuplicateGroup {
    linesOfCode: number;
    occurrences: {
        path: string;
        startLine: number;
        endLine: number;
    }[];
}
export interface SecretFinding {
    path: string;
    line: number;
    rule: string;
    snippet: string;
}
