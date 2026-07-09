"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stage1ToFindings = stage1ToFindings;
function stage1ToFindings(stage1) {
    const findings = [];
    for (const d of stage1.tsDiagnostics) {
        findings.push({
            severity: 'high',
            category: 'Logic',
            title: 'TypeScript compile error',
            line: d.line || null,
            description: d.message,
            rootCause: 'The code does not compile as written.',
            suggestedFix: 'Fix the compiler error before this can run.',
            examplePatch: null,
            confidence: 1,
        });
    }
    for (const l of stage1.lint) {
        if (l.severity !== 'error')
            continue;
        findings.push({
            severity: 'medium',
            category: 'Logic',
            title: `Lint error: ${l.ruleId ?? 'unknown rule'}`,
            line: l.line || null,
            description: l.message,
            rootCause: `Violates the ${l.ruleId ?? ''} rule.`,
            suggestedFix: 'Address the lint error.',
            examplePatch: null,
            confidence: 0.9,
        });
    }
    if (!stage1.semgrep.skipped) {
        for (const s of stage1.semgrep.findings) {
            findings.push({
                severity: 'medium',
                category: 'Security',
                title: `Semgrep: ${s.pattern}`,
                line: s.line || null,
                description: s.snippet || s.pattern,
                rootCause: 'Matched a Semgrep security rule.',
                suggestedFix: 'Review the flagged pattern.',
                examplePatch: null,
                confidence: 0.75,
            });
        }
    }
    for (const fn of stage1.functions) {
        if (fn.complexity > 10 && !stage1.riskyFunctions.some((r) => r.fn.name === fn.name)) {
            findings.push({
                severity: 'low',
                category: 'Maintainability',
                title: `High cyclomatic complexity: ${fn.name}()`,
                line: fn.startLine,
                description: `Complexity of ${fn.complexity} makes this function harder to test and reason about.`,
                rootCause: 'Too many independent branches/conditions in one function.',
                suggestedFix: 'Split into smaller functions with single responsibilities.',
                examplePatch: null,
                confidence: 0.7,
            });
        }
    }
    return findings;
}
//# sourceMappingURL=to-findings.js.map