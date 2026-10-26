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
    { pattern: /AuthorizationLevel\.Anonymous/, reason: 'HTTP endpoint open to anonymous callers', weight: 5 },
    { pattern: /\[AllowAnonymous\]/, reason: 'endpoint that skips authentication', weight: 4 },
    {
        pattern: /\[HttpTrigger\b|\[Http(Get|Post|Put|Delete|Patch)\b|@(Get|Post|Put|Delete|Patch|Request)Mapping\b|@app\.(route|get|post)\b|\brouter\.(get|post|put|delete|patch)\s*\(|\bapp\.Map(Get|Post|Put|Delete)\s*\(/,
        reason: 'HTTP endpoint',
        weight: 2,
    },
    {
        pattern: /\b(SELECT|INSERT|UPDATE|DELETE)\b[^"'\n]*["']\s*\+|\+\s*["'][^"'\n]*\b(WHERE|AND|OR|VALUES|SET|IN)\b/i,
        reason: 'SQL built by string concatenation',
        weight: 5,
    },
    {
        pattern: /\$@?"[^"\n]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^"\n]*\{|\bf["'][^"'\n]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^"'\n]*\{/i,
        reason: 'string-interpolated SQL',
        weight: 5,
    },
    {
        pattern: /\b(ExecuteSqlRaw|FromSqlRaw|SqlCommand|OleDbCommand|MySqlCommand|NpgsqlCommand|ExecuteNonQuery|ExecuteReader|ExecuteScalar|createStatement|prepareStatement)\b/,
        reason: 'direct database command',
        weight: 2,
    },
    { pattern: /\b(int|long|short|decimal|double|float)\.Parse\s*\(|\bConvert\.To(Int16|Int32|Int64|Decimal|Double)\s*\(|\bInteger\.parseInt\s*\(|\bstrconv\.Atoi\s*\(/, reason: 'unchecked number parsing', weight: 2 },
    { pattern: /(password|passwd|pwd|resettoken|reset_token)/i, reason: 'handles passwords or reset tokens', weight: 2 },
    { pattern: /(discount|credit|balance|refund|payment|wallet|payout)/i, reason: 'changes money values', weight: 1 },
    { pattern: /connection_?string|\bconnstr\b/i, reason: 'builds or exposes a database connection string', weight: 3 },
    {
        pattern: /\breq(uest)?\.(Query|Form|Body|query|body|params)\b|\[From(Query|Body|Form|Route|Header)\]|ReadAsStringAsync\s*\(|@RequestParam|@RequestBody|\$_(GET|POST|REQUEST)\b/,
        reason: 'reads request input',
        weight: 1,
    },
    { pattern: /\bBinaryFormatter\b|TypeNameHandling\.(All|Auto|Objects)|\bObjectInputStream\b|\bunserialize\s*\(/, reason: 'unsafe deserialization', weight: 5 },
    { pattern: /\bProcess\.Start\s*\(|\bRuntime\.getRuntime\(\)\.exec\s*\(|\bexec\.Command\s*\(/, reason: 'process execution', weight: 4 },
    { pattern: /\b(MD5|SHA1)\.Create\s*\(|MessageDigest\.getInstance\s*\(\s*"(MD5|SHA-?1)"/, reason: 'weak hash algorithm', weight: 3 },
    { pattern: /ServerCertificate(CustomValidation|Validation)Callback\s*=|InsecureSkipVerify\s*:\s*true|verify\s*=\s*False/, reason: 'TLS certificate checks turned off', weight: 4 },
];
const SENSITIVE_PATH = /(auth|login|logon|signin|sign_in|signup|password|passwd|pwd|reset|token|session|oauth|permission|role|admin|payment|billing|invoice|checkout|discount|credit|refund|wallet|order|connectionstring|connection_string|secret|crypto)/i;
const SENSITIVE_PATH_WEIGHT = 2;
const MIN_ESCALATION_SCORE = 2;
const COMPLEXITY_THRESHOLD = 10;
const MAX_ESCALATED_FUNCTIONS = 5;
function scoreFunction(fn, lint, sensitiveFile) {
    const reasons = [];
    let score = 0;
    if (sensitiveFile) {
        score += SENSITIVE_PATH_WEIGHT;
        reasons.push('in a security- or money-sensitive file');
    }
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
function selectRiskyFunctions(functions, lint, filename = '') {
    const sensitiveFile = SENSITIVE_PATH.test(filename.split('/').slice(-2).join('/'));
    return functions
        .map((fn) => scoreFunction(fn, lint, sensitiveFile))
        .filter((r) => r.score >= MIN_ESCALATION_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_ESCALATED_FUNCTIONS);
}
//# sourceMappingURL=risk-scorer.js.map