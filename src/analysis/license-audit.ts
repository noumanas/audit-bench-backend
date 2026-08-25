import pLimit = require('p-limit');
import { ScannedFile } from './types';

export interface LicenseFinding {
  package: string;
  version: string;
  license: string;
  riskLevel: 'high' | 'medium' | 'low';
  reason: string;
}

const REGISTRY_API = 'https://registry.npmjs.org';

// Licenses that are OSI-recognized or otherwise clearly open-source — used
// only to decide whether the *scanned project itself* is open source (in
// which case its dependencies' licenses aren't a compliance question worth
// raising here at all), not to classify dependency risk.
const OSS_LICENSE_PATTERN = /(MIT|ISC|BSD|APACHE|GPL|MPL|UNLICENSE|CC0|WTFPL|ZLIB|X11|PYTHON-2\.0)/i;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Business-framed risk read on a single SPDX-ish license string. Exported
 * for testing. Returns null for permissive or unrecognized licenses — no
 * finding is raised for those.
 */
export function classifyLicense(rawLicense: string | undefined): Pick<LicenseFinding, 'riskLevel' | 'reason'> | null {
  if (!rawLicense) {
    return { riskLevel: 'low', reason: 'No license declared on the registry — legal status unclear without publisher confirmation.' };
  }
  const l = rawLicense.toUpperCase();
  if (l.includes('AGPL')) {
    return {
      riskLevel: 'high',
      reason: 'AGPL requires releasing the source of any networked service that uses this code — high risk for a proprietary SaaS product.',
    };
  }
  if (l.includes('SSPL')) {
    return {
      riskLevel: 'high',
      reason: 'SSPL requires open-sourcing the entire service stack that uses this code — treated as non-OSS-compatible by most commercial legal teams.',
    };
  }
  if (l.includes('GPL') && !l.includes('LGPL')) {
    return {
      riskLevel: 'high',
      reason: 'GPL requires derivative works to be distributed under the same license — generally incompatible with closed-source distribution.',
    };
  }
  if (l.includes('LGPL')) {
    return {
      riskLevel: 'medium',
      reason: 'LGPL permits proprietary use when dynamically linked, but static linking or bundling this code can trigger copyleft obligations.',
    };
  }
  if (l.includes('MPL') || l.includes('EPL') || l.includes('CDDL')) {
    return {
      riskLevel: 'medium',
      reason: 'Weak copyleft — modifications to this specific library must be shared even when used inside a proprietary product.',
    };
  }
  if (/UNKNOWN|UNLICENSED|PROPRIETARY|SEE LICENSE/.test(l)) {
    return { riskLevel: 'low', reason: 'Registry did not report a standard open-source license — verify terms manually before distribution.' };
  }
  return null;
}

/** True when the scanned project's own declared license looks closed-source/internal rather than OSS. */
export function looksProprietary(packageJsonRaw: string): boolean {
  try {
    const pkg = JSON.parse(packageJsonRaw);
    if (pkg.private === true) return true;
    const license: string | undefined = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
    if (!license) return true; // no license declared — most likely private/internal
    // npm's own "no license, all rights reserved" convention — must be
    // checked before the OSS pattern below, since "UNLICENSED" would
    // otherwise substring-match the real OSS "Unlicense" (public domain).
    if (license.toUpperCase() === 'UNLICENSED') return true;
    return !OSS_LICENSE_PATTERN.test(license);
  } catch {
    return false; // unparseable package.json — don't guess, skip rather than risk a false alarm
  }
}

/**
 * Flags copyleft or unclear-license dependencies when the scanned project
 * itself looks closed-source (e.g. GPL in a commercial codebase). Reads
 * exact resolved versions from the lockfile and queries the npm registry's
 * public metadata for each — no local `npm install`, same reasoning as
 * auditNpmDependencies in dependency-audit.ts. devDependencies are skipped:
 * they aren't distributed with the shipped product, so their license
 * doesn't create the same obligation.
 */
export async function auditLicenses(files: ScannedFile[]): Promise<LicenseFinding[]> {
  const packageJsonFile = files.find((f) => f.path === 'package.json');
  const lockfile = files.find((f) => f.path === 'package-lock.json');
  if (!packageJsonFile || !lockfile) return [];
  if (!looksProprietary(packageJsonFile.content)) return [];

  let lock: any;
  try {
    lock = JSON.parse(lockfile.content);
  } catch {
    return [];
  }
  // lockfileVersion 1's nested `dependencies` tree isn't handled here — only
  // v2/v3's flat `packages` map, which is what modern npm generates.
  if (!lock.packages || typeof lock.lockfileVersion !== 'number' || lock.lockfileVersion < 2) return [];

  const resolved = new Map<string, string>(); // package name -> resolved version, deduped
  for (const [key, info] of Object.entries<any>(lock.packages)) {
    if (!key.startsWith('node_modules/') || info?.dev || !info?.version) continue;
    const name = key.slice('node_modules/'.length).replace(/.*\/node_modules\//, '');
    if (name) resolved.set(name, info.version);
  }

  const entries = [...resolved.entries()].slice(0, 80);
  if (entries.length === 0) return [];

  const limit = pLimit(8);
  const results = await Promise.all(
    entries.map(([name, version]) =>
      limit(async (): Promise<LicenseFinding | null> => {
        try {
          const res = await fetchWithTimeout(`${REGISTRY_API}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, 8_000);
          if (!res.ok) return null;
          const data = await res.json();
          const rawLicense: string | undefined = typeof data.license === 'string' ? data.license : data.license?.type;
          const classified = classifyLicense(rawLicense);
          return classified ? { package: name, version, license: rawLicense || 'UNKNOWN', ...classified } : null;
        } catch {
          return null;
        }
      }),
    ),
  );

  return results.filter((r): r is LicenseFinding => r !== null).slice(0, 50);
}
