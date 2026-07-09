export interface LineRange {
    start: number;
    end: number;
}
export declare function parseChangedRanges(patch: string): LineRange[];
export declare function overlapsAny(start: number, end: number, ranges: LineRange[] | undefined): boolean;
