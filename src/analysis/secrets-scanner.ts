import { ScannedFile, SecretFinding } from './types';

const RULES: { name: string; pattern: RegExp }[] = [
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

export function scanSecrets(files: ScannedFile[]): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const file of files) {
    const lines = file.content.split('\n');
    lines.forEach((line, idx) => {
      if (SKIP_PATTERNS.some((p) => p.test(line))) return;
      for (const rule of RULES) {
        const match = rule.pattern.exec(line);
        if (match) {
          findings.push({
            path: file.path,
            line: idx + 1,
            rule: rule.name,
            // Never store the secret itself: just enough to recognise which one it is.
            snippet: maskSecret(line.trim(), match[0]).slice(0, 160),
          });
          break;
        }
      }
    });
  }

  return findings.slice(0, 50);
}

/** The line with the secret replaced by its first 4 and last 2 characters, e.g. "AKIA…7Q". */
export function maskSecret(line: string, secret: string): string {
  const masked = secret.length > 8 ? `${secret.slice(0, 4)}…${secret.slice(-2)}` : '…';
  return line.split(secret).join(masked);
}
