"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clampScore = clampScore;
exports.scoreForCategories = scoreForCategories;
exports.extraSecurityDeduction = extraSecurityDeduction;
exports.extraDebtDeduction = extraDebtDeduction;
const SEVERITY_WEIGHT = {
    critical: 30,
    high: 15,
    medium: 6,
    low: 2,
};
const NPM_AUDIT_WEIGHT = {
    critical: 30,
    high: 15,
    moderate: 6,
    low: 2,
};
function clampScore(raw) {
    return Math.max(0, Math.min(100, Math.round(raw)));
}
function scoreForCategories(findings, categories) {
    const deduction = findings
        .filter((f) => categories.includes(f.category))
        .reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 6), 0);
    return clampScore(100 - deduction);
}
function extraSecurityDeduction(secretsCount, vulnSeverities) {
    const secretsDeduction = secretsCount * 20;
    const vulnDeduction = vulnSeverities.reduce((sum, s) => sum + (NPM_AUDIT_WEIGHT[s] ?? 6), 0);
    return secretsDeduction + vulnDeduction;
}
function extraDebtDeduction(deadCodeCount, duplicatesCount, circularImportsCount) {
    return deadCodeCount * 3 + duplicatesCount * 4 + circularImportsCount * 8;
}
//# sourceMappingURL=scoring.js.map