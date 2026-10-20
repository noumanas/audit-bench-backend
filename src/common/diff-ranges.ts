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

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'renamed' | 'removed';
  ranges: LineRange[];
}

/**
 * Splits a whole-PR unified diff (Bitbucket's /pullrequests/{id}/diff) into
 * its files, with each file's changed line ranges in the new version.
 * Removed and binary files come back with no ranges.
 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const chunk of diff.split(/^diff --git /m).slice(1)) {
    const lines = chunk.split('\n');
    const plus = lines.find((l) => l.startsWith('+++ '));
    const minus = lines.find((l) => l.startsWith('--- '));
    const header = /^a\/(.+?) b\/(.+)$/.exec(lines[0] ?? '');
    const newPath = plus && plus !== '+++ /dev/null' ? plus.slice(4).replace(/^b\//, '').trim() : null;
    const path = newPath ?? header?.[2] ?? header?.[1];
    if (!path) continue;
    const status: DiffFile['status'] =
      plus === '+++ /dev/null'
        ? 'removed'
        : minus === '--- /dev/null'
          ? 'added'
          : header && header[1] !== header[2]
            ? 'renamed'
            : 'modified';
    files.push({ path, status, ranges: status === 'removed' ? [] : parseChangedRanges(chunk) });
  }
  return files;
}
