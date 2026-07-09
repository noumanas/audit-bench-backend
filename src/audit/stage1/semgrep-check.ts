import { execFile } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { RiskySignal, Stage1Result } from './types';

let semgrepAvailable: boolean | null = null;

function checkSemgrepInstalled(): Promise<boolean> {
  if (semgrepAvailable !== null) return Promise.resolve(semgrepAvailable);
  return new Promise((resolve) => {
    execFile('semgrep', ['--version'], (err) => {
      semgrepAvailable = !err;
      resolve(semgrepAvailable);
    });
  });
}

/**
 * Best-effort — Semgrep is an external CLI this app doesn't install for
 * you. If it's on PATH we use it as a free extra static-analysis pass;
 * if not, Stage 1 just proceeds without it rather than failing the audit.
 */
export async function runSemgrep(code: string, filename: string): Promise<Stage1Result['semgrep']> {
  const installed = await checkSemgrepInstalled();
  if (!installed) {
    return { skipped: true, reason: 'semgrep is not installed on this server (optional — see README)' };
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'semgrep-'));
  const filePath = path.join(dir, path.basename(filename) || 'snippet.txt');

  try {
    await writeFile(filePath, code, 'utf8');
    const findings = await new Promise<RiskySignal[]>((resolve) => {
      execFile(
        'semgrep',
        ['--config', 'auto', '--json', '--quiet', '--timeout', '20', filePath],
        { maxBuffer: 10 * 1024 * 1024 },
        (_err, stdout) => {
          try {
            const parsed = JSON.parse(stdout || '{}');
            const results = Array.isArray(parsed.results) ? parsed.results : [];
            resolve(
              results.slice(0, 20).map((r: any) => ({
                pattern: r.check_id || 'semgrep-rule',
                line: r.start?.line ?? 0,
                snippet: (r.extra?.lines || '').slice(0, 160),
              })),
            );
          } catch {
            resolve([]);
          }
        },
      );
    });
    return { skipped: false, findings };
  } catch {
    return { skipped: true, reason: 'semgrep run failed' };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
