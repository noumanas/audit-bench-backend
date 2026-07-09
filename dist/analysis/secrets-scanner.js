"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSecrets = scanSecrets;
const RULES = [
    { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
    { name: 'Private Key', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'Slack Token', pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
    { name: 'Stripe Live Key', pattern: /sk_live_[0-9A-Za-z]{16,}/ },
    { name: 'GitHub Token', pattern: /gh[pousr]_[0-9A-Za-z]{20,}/ },
    {
        name: 'Hardcoded API/Secret Key',
        pattern: /(api|secret|access)[_-]?key\s*[:=]\s*['"][A-Za-z0-9\-_/+=]{16,}['"]/i,
    },
];
const SKIP_PATTERNS = [/process\.env/, /import\.meta\.env/, /\$\{/, /os\.environ/];
function scanSecrets(files) {
    const findings = [];
    for (const file of files) {
        const lines = file.content.split('\n');
        lines.forEach((line, idx) => {
            if (SKIP_PATTERNS.some((p) => p.test(line)))
                return;
            for (const rule of RULES) {
                if (rule.pattern.test(line)) {
                    findings.push({
                        path: file.path,
                        line: idx + 1,
                        rule: rule.name,
                        snippet: line.trim().slice(0, 160),
                    });
                    break;
                }
            }
        });
    }
    return findings.slice(0, 50);
}
//# sourceMappingURL=secrets-scanner.js.map