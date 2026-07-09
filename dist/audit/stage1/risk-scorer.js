"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectRiskyFunctions = selectRiskyFunctions;
const RISKY_PATTERNS = [
    { pattern: /\beval\s*\(/, reason: 'eval()', weight: 5 },
    { pattern: /\bnew Function\s*\(/, reason: 'dynamic Function construction', weight: 5 },
    { pattern: /\b(exec|execSync|spawn|spawnSync)\s*\(/, reason: 'shell/process execution', weight: 4 },
    { pattern: /dangerouslySetInnerHTML/, reason: 'dangerouslySetInnerHTML', weight: 4 },
    { pattern: /\.innerHTML\s*=/, reason: 'raw innerHTML assignment', weight: 3 },
    { pattern: /document\.write\s*\(/, reason: 'document.write', weight: 3 },
    { pattern: /\bSELECT\b.*\$\{|\bINSERT\b.*\$\{|\bUPDATE\b.*\$\{|\bDELETE\b.*\$\{/i, reason: 'string-interpolated SQL', weight: 5 },
    { pattern: /createClient\([^)]*SERVICE_ROLE/i, reason: 'service-role key usage', weight: 4 },
    { pattern: /jwt\.(sign|verify)\s*\(/, reason: 'JWT sign/verify', weight: 3 },
    { pattern: /(password|secret|token|apiKey)\s*[:=]\s*['"][^'"]{8,}['"]/i, reason: 'possible hardcoded credential', weight: 5 },
    { pattern: /\bMath\.random\s*\(\s*\)/, reason: 'Math.random() used where crypto randomness may matter', weight: 2 },
    { pattern: /\bcreateHash\s*\(\s*['"](md5|sha1)['"]/, reason: 'weak hash algorithm', weight: 3 },
    { pattern: /localStorage\.(setItem|getItem)/, reason: 'localStorage access', weight: 1 },
    { pattern: /fetch\s*\(\s*[^)'"`]/, reason: 'dynamically constructed request URL', weight: 2 },
    { pattern: /\bos\.system\s*\(|subprocess\./, reason: 'shell execution (Python)', weight: 4 },
];
const COMPLEXITY_THRESHOLD = 10;
const MAX_ESCALATED_FUNCTIONS = 5;
function scoreFunction(fn, lint) {
    const reasons = [];
    let score = 0;
    for (const { pattern, reason, weight } of RISKY_PATTERNS) {
        if (pattern.test(fn.code)) {
            score += weight;
            reasons.push(reason);
        }
    }
    if (fn.complexity > COMPLEXITY_THRESHOLD) {
        score += Math.min(5, Math.floor((fn.complexity - COMPLEXITY_THRESHOLD) / 2) + 2);
        reasons.push(`high cyclomatic complexity (${fn.complexity})`);
    }
    const inRange = lint.filter((l) => l.line >= fn.startLine && l.line <= fn.endLine);
    const errorCount = inRange.filter((l) => l.severity === 'error').length;
    if (errorCount > 0) {
        score += errorCount * 2;
        reasons.push(`${errorCount} lint error(s) in range`);
    }
    return { fn, score, reasons };
}
function selectRiskyFunctions(functions, lint) {
    return functions
        .map((fn) => scoreFunction(fn, lint))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_ESCALATED_FUNCTIONS);
}
//# sourceMappingURL=risk-scorer.js.map