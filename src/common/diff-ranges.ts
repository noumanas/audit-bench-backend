export interface LineRange {
  start: number;
  end: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses a unified-diff hunk (GitHub PR "patch" / GitLab MR "diff" field)
 * into the line ranges it touches in the NEW version of the file — what a
 * PR/MR actually changed, so review can focus there instead of re-reading
 * the whole file every time.
 */
export function parseChangedRanges(patch: string): LineRange[] {
  const ranges: LineRange[] = [];
  for (const line of patch.split('\n')) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      const start = parseInt(m[1], 10);
      const length = m[2] ? parseInt(m[2], 10) : 1;
      ranges.push({ start, end: start + Math.max(length, 1) - 1 });
    }
  }
  return ranges;
}

/** No ranges provided means "don't filter" (a normal, non-diff-scoped audit). */
export function overlapsAny(start: number, end: number, ranges: LineRange[] | undefined): boolean {
  if (!ranges || ranges.length === 0) return true;
  return ranges.some((r) => start <= r.end && end >= r.start);
}
