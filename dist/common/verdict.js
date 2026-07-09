"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.worstVerdict = worstVerdict;
exports.verdictForSeverities = verdictForSeverities;
const RANK = { pass: 0, needs_work: 1, do_not_ship: 2 };
function worstVerdict(verdicts) {
    return verdicts.reduce((worst, v) => (RANK[v] > RANK[worst] ? v : worst), 'pass');
}
function verdictForSeverities(findings) {
    if (findings.some((f) => f.severity === 'critical'))
        return 'do_not_ship';
    if (findings.some((f) => f.severity === 'high' || f.severity === 'medium'))
        return 'needs_work';
    return 'pass';
}
//# sourceMappingURL=verdict.js.map