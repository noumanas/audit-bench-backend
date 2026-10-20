export interface LineRange {
    start: number;
    end: number;
}
export declare function parseChangedRanges(patch: string): LineRange[];
export declare function overlapsAny(start: number, end: number, ranges: LineRange[] | undefined): boolean;
export interface DiffFile {
    path: string;
    status: 'added' | 'modified' | 'renamed' | 'removed';
    ranges: LineRange[];
}
export declare function parseUnifiedDiff(diff: string): DiffFile[];
