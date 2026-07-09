import { execFile } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { ScannedFile } from './types';

export interface DependencyVulnerability {
  package: string;
  severity: string;
  title: string;
  url: string;
  range: string;
}

/**
 * Free — runs `npm audit` against the repo's own lockfile, no LLM involved.
 * Requires a package-lock.json in the scan (npm audit needs a resolved
 * dependency tree); a package.json with no lockfile is skipped rather than
 * running `npm install`, which would need network access and could be slow
 * or unreliable inside a scan request.
 */
export async function auditDependencies(files: ScannedFile[]): Promise<DependencyVulnerability[]> {
  const packageJson = files.find((f) => f.path === 'package.json');
  const lockfile = files.find((f) => f.path === 'package-lock.json');
  if (!packageJson || !lockfile) return [];

  const dir = await mkdtemp(path.join(tmpdir(), 'npm-audit-'));

  try {
    await writeFile(path.join(dir, 'package.json'), packageJson.content, 'utf8');
    await writeFile(path.join(dir, 'package-lock.json'), lockfile.content, 'utf8');

    const stdout = await new Promise<string>((resolve) => {
      execFile(
        'npm',
        ['audit', '--json', '--package-lock-only'],
        { cwd: dir, timeout: 20_000, maxBuffer: 10 * 1024 * 1024 },
        (_err, out) => resolve(out || '{}'), // npm audit exits non-zero when it finds vulnerabilities — that's not a failure here
      );
    });

    const parsed = JSON.parse(stdout);
    const vulnerabilities = parsed.vulnerabilities || {};

    const findings: DependencyVulnerability[] = [];
    for (const [pkgName, info] of Object.entries<any>(vulnerabilities)) {
      const via = Array.isArray(info.via) ? info.via.filter((v: any) => typeof v === 'object') : [];
      for (const v of via.slice(0, 3)) {
        findings.push({
          package: pkgName,
          severity: v.severity || info.severity || 'unknown',
          title: v.title || `Vulnerable dependency: ${pkgName}`,
          url: v.url || '',
          range: v.range || info.range || '',
        });
      }
    }
    return findings.slice(0, 50);
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
