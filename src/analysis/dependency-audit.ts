import { execFile } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import pLimit = require('p-limit');
import { ScannedFile } from './types';

export interface DependencyVulnerability {
  package: string;
  severity: string;
  title: string;
  url: string;
  range: string;
}

export async function auditDependencies(files: ScannedFile[]): Promise<DependencyVulnerability[]> {
  const [npm, python] = await Promise.all([auditNpmDependencies(files), auditPythonDependencies(files)]);
  return [...npm, ...python].slice(0, 50);
}

/**
 * Free — runs `npm audit` against the repo's own lockfile, no LLM involved.
 * Requires a package-lock.json in the scan (npm audit needs a resolved
 * dependency tree); a package.json with no lockfile is skipped rather than
 * running `npm install`, which would need network access and could be slow
 * or unreliable inside a scan request.
 */
async function auditNpmDependencies(files: ScannedFile[]): Promise<DependencyVulnerability[]> {
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

const OSV_API = 'https://api.osv.dev/v1';
const REQUIREMENTS_LINE = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*([A-Za-z0-9._+!-]+)/;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Free — batches every `==`-pinned requirements.txt entry against OSV.dev's
 * public vulnerability database. No local Python/pip-audit install needed,
 * which keeps the node:20-alpine Docker image untouched. Loose (unpinned)
 * requirements are skipped since OSV needs a specific version to match
 * against.
 */
async function auditPythonDependencies(files: ScannedFile[]): Promise<DependencyVulnerability[]> {
  const requirements = files.find((f) => f.path === 'requirements.txt' || f.path.endsWith('/requirements.txt'));
  if (!requirements) return [];

  const packages: { name: string; version: string }[] = [];
  for (const rawLine of requirements.content.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line || line.startsWith('-')) continue;
    const match = REQUIREMENTS_LINE.exec(line);
    if (match) packages.push({ name: match[1], version: match[2] });
  }
  if (packages.length === 0) return [];

  const capped = packages.slice(0, 50);

  let batchResults: any;
  try {
    const res = await fetchWithTimeout(
      `${OSV_API}/querybatch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: capped.map((p) => ({ package: { name: p.name, ecosystem: 'PyPI' }, version: p.version })),
        }),
      },
      10_000,
    );
    if (!res.ok) return [];
    batchResults = await res.json();
  } catch {
    return [];
  }

  // Map each vuln id back to the package(s) it came from, deduped, capped
  // before the (more expensive) per-vuln detail fetch.
  const idToPackages = new Map<string, Set<string>>();
  for (let i = 0; i < capped.length; i++) {
    const vulns = batchResults?.results?.[i]?.vulns || [];
    for (const v of vulns) {
      if (!idToPackages.has(v.id)) idToPackages.set(v.id, new Set());
      idToPackages.get(v.id)!.add(capped[i].name);
    }
  }
  const ids = [...idToPackages.keys()].slice(0, 40);
  if (ids.length === 0) return [];

  const limit = pLimit(5);
  const details = await Promise.all(
    ids.map((id) =>
      limit(async () => {
        try {
          const res = await fetchWithTimeout(`${OSV_API}/vulns/${id}`, {}, 10_000);
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      }),
    ),
  );

  const findings: DependencyVulnerability[] = [];
  for (const detail of details) {
    if (!detail) continue;
    const packageNames = idToPackages.get(detail.id) ?? new Set<string>();
    // OSV's `severity` field is a raw CVSS vector string, not a score — not
    // worth parsing for this. `database_specific.severity` (GHSA-sourced
    // advisories, the common case for PyPI) already gives a plain label.
    const severity = detail.database_specific?.severity?.toLowerCase() || 'unknown';
    for (const pkgName of packageNames) {
      const pinned = capped.find((p) => p.name === pkgName)?.version || '';
      findings.push({
        package: pkgName,
        severity,
        title: detail.summary || `Vulnerable dependency: ${pkgName}`,
        url: `https://osv.dev/vulnerability/${detail.id}`,
        range: pinned,
      });
    }
  }
  return findings.slice(0, 50);
}
