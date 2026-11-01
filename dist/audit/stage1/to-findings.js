"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.complexityFinding = complexityFinding;
exports.stage1ToFindings = stage1ToFindings;
const review_thresholds_1 = require("../../common/review-thresholds");
const COMPLEXITY_FLOOR = 10;
function complexityFinding(fn, t = review_thresholds_1.DEFAULT_THRESHOLDS) {
    if (fn.complexity <= COMPLEXITY_FLOOR)
        return null;
    const nesting = fn.maxNesting ?? 0;
    const deep = nesting >= t.deepNesting;
    if (!deep && fn.complexity < t.veryHighComplexity)
        return null;
    const span = `lines ${fn.startLine}-${fn.endLine}`;
    return deep
        ? {
            severity: 'low',
            category: 'Maintainability',
            title: `Deeply nested conditions in ${fn.name}()`,
            line: fn.startLine,
            endLine: fn.endLine,
            description: `${fn.name}() (${span}) nests conditions ${nesting} levels deep, with ${fn.complexity} paths through it. At that depth it is hard to see which conditions hold at any line, which is where missed edge cases tend to hide.`,
            rootCause: 'Conditions are handled by nesting further rather than exiting early.',
            suggestedFix: 'Return early for the simple cases so the main path sits at one level, or move the innermost nested block into a named helper. Make sure each path has a test before restructuring.',
            examplePatch: null,
            confidence: 0.65,
        }
        : {
            severity: 'low',
            category: 'Maintainability',
            title: `Very large number of branches in ${fn.name}()`,
            line: fn.startLine,
            endLine: fn.endLine,
            description: `${fn.name}() (${span}) has ${fn.complexity} paths through it. The branches are not deeply nested, so this is only worth changing if they handle unrelated jobs or the function keeps growing.`,
            rootCause: 'Many cases are handled in one function.',
            suggestedFix: 'If the branches map inputs to outputs, a lookup table can replace them. If they do unrelated jobs, separate those jobs. Otherwise no change is needed.',
            examplePatch: null,
            confidence: 0.5,
        };
}
function stage1ToFindings(stage1, thresholds = review_thresholds_1.DEFAULT_THRESHOLDS) {
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
    for (const p of stage1.python) {
        findings.push({
            severity: p.severity === 'error' ? 'high' : 'medium',
            category: 'Security',
            title: `Python check: ${p.ruleId}`,
            line: p.line || null,
            description: p.message,
            rootCause: 'Python local audit matched a risky pattern.',
            suggestedFix: 'Review the code path and replace the risky pattern with a safer alternative.',
            examplePatch: null,
            confidence: p.severity === 'error' ? 0.9 : 0.75,
        });
    }
    for (const p of stage1.patterns ?? []) {
        findings.push({
            severity: p.severity === 'error' ? 'high' : 'medium',
            category: p.ruleId.startsWith('errors/') ? 'Logic' : 'Security',
            title: p.title,
            line: p.line || null,
            description: p.message,
            rootCause: `Matched the local rule ${p.ruleId}.`,
            suggestedFix: p.message,
            examplePatch: null,
            confidence: p.severity === 'error' ? 0.85 : 0.7,
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
        if (stage1.riskyFunctions.some((r) => r.fn.name === fn.name))
            continue;
        const finding = complexityFinding(fn, thresholds);
        if (finding)
            findings.push(finding);
    }
    return findings;
}
//# sourceMappingURL=to-findings.js.map