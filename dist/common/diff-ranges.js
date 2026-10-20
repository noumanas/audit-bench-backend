"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChangedRanges = parseChangedRanges;
exports.overlapsAny = overlapsAny;
exports.parseUnifiedDiff = parseUnifiedDiff;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
function parseChangedRanges(patch) {
    const ranges = [];
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
function overlapsAny(start, end, ranges) {
    if (!ranges || ranges.length === 0)
        return true;
    return ranges.some((r) => start <= r.end && end >= r.start);
}
function parseUnifiedDiff(diff) {
    const files = [];
    for (const chunk of diff.split(/^diff --git /m).slice(1)) {
        const lines = chunk.split('\n');
        const plus = lines.find((l) => l.startsWith('+++ '));
        const minus = lines.find((l) => l.startsWith('--- '));
        const header = /^a\/(.+?) b\/(.+)$/.exec(lines[0] ?? '');
        const newPath = plus && plus !== '+++ /dev/null' ? plus.slice(4).replace(/^b\//, '').trim() : null;
        const path = newPath ?? header?.[2] ?? header?.[1];
        if (!path)
            continue;
        const status = plus === '+++ /dev/null'
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
//# sourceMappingURL=diff-ranges.js.map