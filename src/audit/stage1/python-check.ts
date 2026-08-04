import { PythonFinding } from './types';

const PYTHON_FILENAME = /\.(py|pyi)$/i;

const RULES: { pattern: RegExp; ruleId: string; message: string; severity: 'warning' | 'error' }[] = [
  { pattern: /\beval\s*\(/, ruleId: 'python/no-eval', message: 'Avoid eval(); it can execute arbitrary code.', severity: 'error' },
  { pattern: /\bexec\s*\(/, ruleId: 'python/no-exec', message: 'Avoid exec(); it can execute arbitrary code.', severity: 'error' },
  { pattern: /\bos\.system\s*\(/, ruleId: 'python/no-os-system', message: 'Prefer subprocess with explicit arguments over os.system().', severity: 'error' },
  { pattern: /\bsubprocess\.(call|run|Popen|check_call|check_output)\s*\(/, ruleId: 'python/subprocess-review', message: 'Review subprocess usage carefully; prefer explicit argument lists and safe inputs.', severity: 'warning' },
  { pattern: /\bpickle\.(loads|load)\s*\(/, ruleId: 'python/no-pickle', message: 'Avoid pickle for untrusted data; it can execute code during deserialization.', severity: 'error' },
  { pattern: /\byaml\.load\s*\(/, ruleId: 'python/yaml-load', message: 'Use yaml.safe_load() instead of yaml.load() for untrusted input.', severity: 'error' },
  { pattern: /\bFastAPI\s*\([^)]*debug\s*=\s*True/i, ruleId: 'fastapi/debug-mode', message: 'Disable debug mode in FastAPI applications.', severity: 'error' },
  { pattern: /\buvicorn\.run\s*\([^)]*reload\s*=\s*True/i, ruleId: 'fastapi/reload-mode', message: 'Do not run Uvicorn with reload=True in production.', severity: 'warning' },
  { pattern: /\bSQLAlchemy\b|from\s+sqlalchemy/i, ruleId: 'python/sqlalchemy-review', message: 'Review SQLAlchemy usage for raw SQL, injection risks, and unsafe string interpolation.', severity: 'warning' },
  { pattern: /\bcreate_engine\s*\([^)]*(echo\s*=\s*True|future\s*=\s*False)/i, ruleId: 'python/sqlalchemy-config', message: 'Review SQLAlchemy engine settings for verbose logging or legacy configuration.', severity: 'warning' },
  { pattern: /\bsecrets?\s*=\s*['"][^'"]{8,}['"]/i, ruleId: 'python/hardcoded-secret', message: 'Possible hardcoded secret or token.', severity: 'error' },
  { pattern: /\b(password|token|secret|api_key|apikey)\s*=\s*['"][^'"]{8,}['"]/i, ruleId: 'python/hardcoded-credential', message: 'Possible hardcoded credential.', severity: 'error' },
];

export function runPythonCheck(code: string, filename: string): PythonFinding[] {
  if (!PYTHON_FILENAME.test(filename)) return [];

  const lines = code.split('\n');
  const findings: PythonFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          line: i + 1,
          ruleId: rule.ruleId,
          message: rule.message,
          severity: rule.severity,
        });
      }
    }
  }

  return findings;
}
