"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterStage1ToRanges = filterStage1ToRanges;
const diff_ranges_1 = require("../../common/diff-ranges");
function filterStage1ToRanges(stage1, ranges) {
    const riskyFunctions = stage1.riskyFunctions.filter((r) => (0, diff_ranges_1.overlapsAny)(r.fn.startLine, r.fn.endLine, ranges));
    const tsDiagnostics = stage1.tsDiagnostics.filter((d) => (0, diff_ranges_1.overlapsAny)(d.line, d.line, ranges));
    const lint = stage1.lint.filter((l) => (0, diff_ranges_1.overlapsAny)(l.line, l.line, ranges));
    const semgrep = stage1.semgrep.skipped
        ? stage1.semgrep
        : { skipped: false, findings: stage1.semgrep.findings.filter((f) => (0, diff_ranges_1.overlapsAny)(f.line, f.line, ranges)) };
    const semgrepFlagged = !semgrep.skipped && semgrep.findings.length > 0;
    return {
        ...stage1,
        lint,
        tsDiagnostics,
        semgrep,
        riskyFunctions,
        clean: riskyFunctions.length === 0 && tsDiagnostics.length === 0 && !semgrepFlagged,
    };
}
//# sourceMappingURL=filter-to-ranges.js.map