"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSecrets = scanSecrets;
exports.uniqueSecretCount = uniqueSecretCount;
exports.maskSecret = maskSecret;
const crypto_1 = require("crypto");
const RULES = [
    { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
    { name: 'Private Key', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'Slack Token', pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
    { name: 'Stripe Live Key', pattern: /sk_live_[0-9A-Za-z]{16,}/ },
    { name: 'GitHub Token', pattern: /gh[pousr]_[0-9A-Za-z]{20,}/ },
    { name: 'Shopify Access Token', pattern: /shp(at|ss|ca|pa)_[a-fA-F0-9]{32}/ },
    {
        name: 'Database Connection String Password',
        pattern: /(?:Server|Data Source|Host|Address)\s*=[^;"'\n]+;[^"'\n]*?(?:Password|Pwd)\s*=\s*([^;"'\s<>]{3,})/i,
        value: 1,
    },
    { name: 'Azure Storage Account Key', pattern: /AccountKey=([A-Za-z0-9+/=]{20,})/, value: 1 },
    { name: 'Azure Shared Access Key', pattern: /SharedAccessKey=([A-Za-z0-9+/=]{20,})/, value: 1 },
    {
        name: 'Hardcoded API/Secret Key',
        pattern: /(api|secret|access)[_-]?key\s*[:=]\s*['"]([A-Za-z0-9\-_/+=]{16,})['"]/i,
        value: 2,
    },
    {
        name: 'Password or Key in Config',
        pattern: /"(?:password|pwd|passwd|secret|client_?secret|api_?key|apikey|access_?token|auth_?token|accesstoken|shared_?secret)"\s*:\s*"([^"]{6,})"/i,
        value: 1,
    },
    {
        name: 'Password or Key in Config',
        pattern: /<add\s+key="[^"]*(?:key|secret|password|token)[^"]*"\s+value="([^"]{6,})"/i,
        value: 1,
    },
];
const SKIP_PATTERNS = [/process\.env/, /import\.meta\.env/, /\$\{/, /os\.environ/];
const PLACEHOLDER = /^(\$\(|\$\{|<|\{\{|%|\[|your[-_ ]|change[-_ ]?me|xxx|\*+$|example|placeholder|todo|null|none|true|false|dummy|test$|password$|secret$|@Microsoft\.KeyVault)/i;
function scanSecrets(files) {
    const findings = [];
    const salt = (0, crypto_1.randomBytes)(16);
    const fingerprint = (secret) => (0, crypto_1.createHmac)('sha256', salt).update(secret).digest('hex').slice(0, 12);
    for (const file of files) {
        const lines = file.content.split('\n');
        lines.forEach((line, idx) => {
            if (SKIP_PATTERNS.some((p) => p.test(line)))
                return;
            for (const rule of RULES) {
                const match = rule.pattern.exec(line);
                if (!match)
                    continue;
                const secret = match[rule.value ?? 0] ?? match[0];
                if (PLACEHOLDER.test(secret.trim()))
                    continue;
                findings.push({
                    path: file.path,
                    line: idx + 1,
                    rule: rule.name,
                    snippet: maskSecret(line.trim(), secret).slice(0, 160),
                    fingerprint: fingerprint(secret),
                });
                break;
            }
        });
    }
    return findings.slice(0, 200);
}
function uniqueSecretCount(secrets) {
    if (!Array.isArray(secrets))
        return 0;
    const keys = new Set(secrets.map((s) => s?.fingerprint ?? `${s?.path}:${s?.line}`));
    return keys.size;
}
function maskSecret(line, secret) {
    const masked = secret.length > 8 ? `${secret.slice(0, 4)}…${secret.slice(-2)}` : '…';
    return line.split(secret).join(masked);
}
//# sourceMappingURL=secrets-scanner.js.map