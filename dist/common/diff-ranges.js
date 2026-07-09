"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChangedRanges = parseChangedRanges;
exports.overlapsAny = overlapsAny;
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
//# sourceMappingURL=diff-ranges.js.map