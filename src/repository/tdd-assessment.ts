import { DAY_RATE_HIGH_USD, DAY_RATE_LOW_USD, RiskAggregation, ScanJobRiskInput } from './risk-aggregation';

/**
 * Technical due diligence assessment: 6 executive risk areas → 15 assessment
 * domains → a catalog of concrete checks, each backed by evidence the scan
 * already gathered.
 *
 * Same contract as aggregateRisk: pure, deterministic, no LLM call, computed
 * on every read. A check whose input data this scan never gathered (no AI
 * review ran, no contributor history for a zip upload, no TypeScript files,
 * ...) comes back `not_assessed` — never a silent pass — and the report
 * counts only the checks that actually ran.
 */

export type CheckSeverity = 'critical' | 'high' | 'medium' | 'low';
export type CheckStatus = 'pass' | 'fail' | 'not_assessed';
/** Domain/area rating: worst failed check severity, or `pass` when everything that ran passed. */
export type TddRating = CheckSeverity | 'pass' | 'not_assessed';

export interface CheckEvidence {
  path: string;
  line: number | null;
  note: string;
}

export interface TddCheck {
  id: string;
  title: string;
  domainId: string;
  status: CheckStatus;
  /** Severity this check carries when it fails — what the risk classification is built from. */
  severity: CheckSeverity;
  /** What was measured (on pass/fail) or why it couldn't be (on not_assessed). */
  detail: string;
  businessImpact: string;
  evidence: CheckEvidence[];
}

export interface TddDomain {
  id: string;
  name: string;
  areaId: string;
  rating: TddRating;
  checksRun: number;
  checksPassed: number;
}

export interface TddArea {
  id: string;
  name: string;
  rating: TddRating;
  checksRun: number;
  checksPassed: number;
  /** One line an investor can read without opening the domain detail. */
  headline: string;
}

export type RemediationPhase = 'pre_close' | 'days_30' | 'days_90';

export interface TddRemediationStep {
  areaId: string;
  phase: RemediationPhase;
  category: string;
  description: string;
  estimatedDays: number;
  costLowUsd: number;
  costHighUsd: number;
}

export interface TddAssessment {
  areas: TddArea[];
  domains: TddDomain[];
  checks: TddCheck[];
  coverage: {
    catalogSize: number;
    checksRun: number;
    checksPassed: number;
    checksFailed: number;
    notAssessed: number;
    filesAnalyzed: number;
    filesInRepository: number;
  };
  riskCounts: Record<CheckSeverity, number>;
  remediationPlan: {
    steps: TddRemediationStep[];
    byPhase: Record<RemediationPhase, { days: number; costLowUsd: number; costHighUsd: number }>;
  };
}

export interface TddInput extends ScanJobRiskInput {
  files: Array<{ path?: unknown; language?: unknown; findings: unknown; stage1?: unknown; aiInvoked?: unknown; fromCache?: unknown }>;
  dependencyGraph?: unknown;
  fileCount?: unknown;
  filesScanned?: unknown;
  createdAt?: unknown;
}

const MAX_EVIDENCE = 6;
const ACTIVE_WINDOW_DAYS = 90;

export const TDD_AREAS: Array<{ id: string; name: string }> = [
  { id: 'security', name: 'Security exposure' },
  { id: 'supply_chain', name: 'Dependency & license risk' },
  { id: 'tech_debt', name: 'Technical debt' },
  { id: 'architecture', name: 'Architecture & scalability' },
  { id: 'engineering', name: 'Engineering practices' },
  { id: 'team', name: 'Team & knowledge' },
];

export const TDD_DOMAINS: Array<{ id: string; name: string; areaId: string }> = [
  { id: 'appsec', name: 'Application security', areaId: 'security' },
  { id: 'secrets', name: 'Secrets & credentials', areaId: 'security' },
  { id: 'config', name: 'Configuration & environment', areaId: 'security' },
  { id: 'dependencies', name: 'Dependency vulnerabilities', areaId: 'supply_chain' },
  { id: 'licenses', name: 'License compliance', areaId: 'supply_chain' },
  { id: 'correctness', name: 'Code correctness', areaId: 'tech_debt' },
  { id: 'complexity', name: 'Complexity & maintainability', areaId: 'tech_debt' },
  { id: 'duplication', name: 'Duplication & dead code', areaId: 'tech_debt' },
  { id: 'consistency', name: 'Architecture consistency', areaId: 'architecture' },
  { id: 'modularity', name: 'Modularity & coupling', areaId: 'architecture' },
  { id: 'performance', name: 'Performance', areaId: 'architecture' },
  { id: 'testing', name: 'Test coverage', areaId: 'engineering' },
  { id: 'delivery', name: 'CI & delivery', areaId: 'engineering' },
  { id: 'concentration', name: 'Knowledge concentration', areaId: 'team' },
  { id: 'continuity', name: 'Development continuity', areaId: 'team' },
];

// ---------------------------------------------------------------------------
// Normalized view of the scan
// ---------------------------------------------------------------------------

interface Finding {
  path: string;
  severity: CheckSeverity | null;
  category: string;
  title: string;
  description: string;
  line: number | null;
}

interface RuleHit {
  path: string;
  line: number | null;
  ruleId: string;
  message: string;
  severity: string;
}

interface FunctionInfo {
  path: string;
  name: string;
  line: number | null;
  complexity: number;
}

interface Ctx {
  findings: Finding[];
  python: RuleHit[];
  lint: RuleHit[];
  tsDiagnostics: RuleHit[];
  semgrep: RuleHit[];
  semgrepRan: boolean;
  functions: FunctionInfo[];
  hasStage1: boolean;
  aiReviewed: boolean;
  hasPython: boolean;
  hasJsTs: boolean;
  hasTs: boolean;
  knownPaths: string[];
  scannedAt: Date | null;
  input: TddInput;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normSeverity(value: unknown): CheckSeverity | null {
  const s = str(value).toLowerCase();
  if (s === 'moderate') return 'medium';
  return s === 'critical' || s === 'high' || s === 'medium' || s === 'low' ? s : null;
}

function buildContext(input: TddInput): Ctx {
  const files = input.files.map((f) => {
    const path = str(f.path) || 'unknown file';
    const stage1 = f.stage1 && typeof f.stage1 === 'object' ? (f.stage1 as Record<string, unknown>) : null;
    // fromCache results came from an earlier AI review of identical content.
    const aiReviewed = f.aiInvoked === true || f.fromCache === true;
    return { path, language: str(f.language).toLowerCase(), stage1, aiReviewed, findings: asArray(f.findings) };
  });

  const findings: Finding[] = [];
  const python: RuleHit[] = [];
  const lint: RuleHit[] = [];
  const tsDiagnostics: RuleHit[] = [];
  const semgrep: RuleHit[] = [];
  const functions: FunctionInfo[] = [];
  let semgrepRan = false;

  for (const f of files) {
    for (const raw of f.findings as Array<Record<string, unknown>>) {
      findings.push({
        path: f.path,
        severity: normSeverity(raw?.severity),
        category: str(raw?.category),
        title: str(raw?.title),
        description: str(raw?.description),
        line: num(raw?.line),
      });
    }
    if (!f.stage1) continue;
    const hit = (raw: Record<string, unknown>, ruleKey = 'ruleId'): RuleHit => ({
      path: f.path,
      line: num(raw?.line),
      ruleId: str(raw?.[ruleKey]),
      message: str(raw?.message) || str(raw?.snippet),
      severity: str(raw?.severity),
    });
    for (const p of asArray(f.stage1.python) as Array<Record<string, unknown>>) python.push(hit(p));
    for (const l of asArray(f.stage1.lint) as Array<Record<string, unknown>>) lint.push(hit(l));
    for (const d of asArray(f.stage1.tsDiagnostics) as Array<Record<string, unknown>>) tsDiagnostics.push(hit(d));
    const sg = f.stage1.semgrep as { skipped?: boolean; findings?: unknown } | undefined;
    if (sg && sg.skipped === false) {
      semgrepRan = true;
      for (const s of asArray(sg.findings) as Array<Record<string, unknown>>) semgrep.push(hit(s, 'pattern'));
    }
    for (const fn of asArray(f.stage1.functions) as Array<Record<string, unknown>>) {
      const complexity = num(fn?.complexity);
      if (complexity !== null) functions.push({ path: f.path, name: str(fn?.name) || 'anonymous', line: num(fn?.startLine), complexity });
    }
  }

  const ext = (p: string) => p.split('.').pop()?.toLowerCase() ?? '';
  const isPython = (f: (typeof files)[number]) => f.language === 'python' || ext(f.path) === 'py';
  const isTs = (f: (typeof files)[number]) => ['ts', 'tsx', 'mts', 'cts'].includes(ext(f.path));
  const isJsTs = (f: (typeof files)[number]) => isTs(f) || ['js', 'jsx', 'mjs', 'cjs'].includes(ext(f.path));
  const withStage1 = files.filter((f) => f.stage1);

  // Every repository path this scan recorded anywhere — the full file
  // listing itself isn't retained, so this is a partial view.
  const known = new Set<string>(files.map((f) => f.path));
  for (const s of asArray(input.secrets) as Array<{ path?: unknown }>) if (str(s?.path)) known.add(str(s.path));
  for (const d of asArray(input.duplicates) as Array<{ occurrences?: unknown }>)
    for (const o of asArray(d?.occurrences) as Array<{ path?: unknown }>) if (str(o?.path)) known.add(str(o.path));
  for (const p of asArray(input.deadCode)) if (str(p)) known.add(str(p));
  const graph = (input.dependencyGraph as { graph?: Record<string, unknown> } | null)?.graph;
  if (graph && typeof graph === 'object') for (const k of Object.keys(graph)) known.add(k);

  const created = input.createdAt instanceof Date ? input.createdAt : str(input.createdAt) ? new Date(str(input.createdAt)) : null;

  return {
    findings,
    python,
    lint,
    tsDiagnostics,
    semgrep,
    semgrepRan,
    functions,
    hasStage1: withStage1.length > 0,
    aiReviewed: files.some((f) => f.aiReviewed),
    hasPython: withStage1.some(isPython),
    hasJsTs: withStage1.some(isJsTs),
    hasTs: withStage1.some(isTs),
    knownPaths: [...known],
    scannedAt: created && !Number.isNaN(created.getTime()) ? created : null,
    input,
  };
}

// ---------------------------------------------------------------------------
// Check catalog
// ---------------------------------------------------------------------------

type Outcome =
  | { status: 'not_assessed'; detail: string }
  | { status: 'pass' | 'fail'; detail: string; evidence?: CheckEvidence[]; severity?: CheckSeverity };

interface CheckDef {
  id: string;
  title: string;
  domainId: string;
  severity: CheckSeverity;
  businessImpact: string;
  run: (ctx: Ctx) => Outcome;
}

const NOT_ANALYZED = 'No source files were analyzed on this scan.';
const NO_AI = 'Needs the AI review stage, which no file on this scan required.';

function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  return `${n} ${/[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}

const NO_GRAPH = 'No internal import graph was built for this codebase’s language.';

/** Internal import graph entries — circular-import and dead-code detection are both derived from it, so without one their empty results mean nothing. */
function graphEntries(ctx: Ctx): Array<[string, unknown]> {
  const graph = (ctx.input.dependencyGraph as { graph?: Record<string, unknown> } | null)?.graph;
  const entries = graph && typeof graph === 'object' ? Object.entries(graph) : [];
  return entries.length >= 2 ? entries : [];
}

function findingEvidence(items: Finding[]): CheckEvidence[] {
  return items.map((f) => ({ path: f.path, line: f.line, note: f.title || f.description }));
}

function hitEvidence(items: RuleHit[]): CheckEvidence[] {
  return items.map((h) => ({ path: h.path, line: h.line, note: h.ruleId ? `${h.ruleId}: ${h.message}` : h.message }));
}

/** Pass when `hits` is empty, fail with evidence otherwise. */
function zeroOf<T>(hits: T[], toEvidence: (items: T[]) => CheckEvidence[], noun: string, cleanDetail: string): Outcome {
  if (hits.length === 0) return { status: 'pass', detail: cleanDetail };
  return { status: 'fail', detail: `${plural(hits.length, noun)} found.`, evidence: toEvidence(hits) };
}

function securityFindings(ctx: Ctx, pattern: RegExp): Finding[] {
  // Stage 1 rule hits are also converted into findings on files that skipped
  // AI review — those are matched by rule id instead, so skip them here to
  // avoid listing the same line twice.
  return ctx.findings.filter(
    (f) => f.category === 'Security' && !/^(Python check|Semgrep):/.test(f.title) && pattern.test(`${f.title} ${f.description}`),
  );
}

function rules(ctx: Ctx, ids: string[]): RuleHit[] {
  return ctx.python.filter((p) => ids.includes(p.ruleId));
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

function contributors(ctx: Ctx): Array<{ author: string; commits: number; lastCommitAt: Date | null }> | null {
  if (ctx.input.contributorStats == null) return null;
  const stats = (asArray(ctx.input.contributorStats) as Array<Record<string, unknown>>)
    .map((s) => {
      const last = str(s?.lastCommitAt) ? new Date(str(s.lastCommitAt)) : null;
      return { author: str(s?.author) || 'unknown', commits: num(s?.commits) ?? 0, lastCommitAt: last && !Number.isNaN(last.getTime()) ? last : null };
    })
    .filter((s) => s.commits > 0)
    .sort((a, b) => b.commits - a.commits);
  return stats.length > 0 ? stats : null;
}

const CHECKS: CheckDef[] = [
  // --- Application security -------------------------------------------------
  {
    id: 'appsec.critical',
    title: 'No critical security vulnerabilities',
    domainId: 'appsec',
    severity: 'critical',
    businessImpact: 'A critical vulnerability is exploitable today and can lead to a data breach, regulatory exposure and a price renegotiation.',
    run: (ctx) =>
      !ctx.hasStage1
        ? { status: 'not_assessed', detail: NOT_ANALYZED }
        : zeroOf(ctx.findings.filter((f) => f.category === 'Security' && f.severity === 'critical'), findingEvidence, 'critical security finding', 'No critical security findings in analyzed files.'),
  },
  {
    id: 'appsec.high',
    title: 'No high-severity security vulnerabilities',
    domainId: 'appsec',
    severity: 'high',
    businessImpact: 'High-severity issues are realistic attack paths that usually need fixing before close or under a specific indemnity.',
    run: (ctx) =>
      !ctx.hasStage1
        ? { status: 'not_assessed', detail: NOT_ANALYZED }
        : zeroOf(ctx.findings.filter((f) => f.category === 'Security' && f.severity === 'high'), findingEvidence, 'high-severity security finding', 'No high-severity security findings in analyzed files.'),
  },
  {
    id: 'appsec.injection',
    title: 'No code or command injection patterns',
    domainId: 'appsec',
    severity: 'high',
    businessImpact: 'Injection lets an attacker run their own code on company servers — a full compromise of the product and its data.',
    run: (ctx) => {
      if (!ctx.hasStage1) return { status: 'not_assessed', detail: NOT_ANALYZED };
      const hits = [
        ...hitEvidence(rules(ctx, ['python/no-eval', 'python/no-exec', 'python/no-os-system', 'python/subprocess-review'])),
        ...findingEvidence(securityFindings(ctx, /\b(command|code|template)?\s*injection|eval\(|exec\(|os\.system|shell/i).filter((f) => !/sql/i.test(f.title))),
      ];
      return zeroOf(hits, (e) => e, 'injection-prone call', 'No eval/exec/shell-execution patterns detected.');
    },
  },
  {
    id: 'appsec.sql',
    title: 'No SQL injection risks',
    domainId: 'appsec',
    severity: 'high',
    businessImpact: 'SQL injection is the most common route to bulk customer-data theft.',
    run: (ctx) => {
      if (!ctx.hasStage1) return { status: 'not_assessed', detail: NOT_ANALYZED };
      const hits = [...hitEvidence(rules(ctx, ['python/sqlalchemy-review'])), ...findingEvidence(securityFindings(ctx, /sql/i))];
      return zeroOf(hits, (e) => e, 'SQL injection signal', 'No raw or string-built SQL flagged.');
    },
  },
  {
    id: 'appsec.deserialization',
    title: 'No unsafe deserialization',
    domainId: 'appsec',
    severity: 'high',
    businessImpact: 'Loading untrusted pickle/YAML data executes arbitrary code — equivalent to remote code execution.',
    run: (ctx) =>
      !ctx.hasPython
        ? { status: 'not_assessed', detail: 'Applies to Python code; none was analyzed.' }
        : zeroOf(rules(ctx, ['python/no-pickle', 'python/yaml-load']), hitEvidence, 'unsafe deserialization call', 'No pickle or unsafe yaml.load usage.'),
  },
  {
    id: 'appsec.auth',
    title: 'No authentication or access-control weaknesses',
    domainId: 'appsec',
    severity: 'high',
    businessImpact: 'Broken auth lets users reach other customers’ data — a breach-notification event for most B2B products.',
    run: (ctx) =>
      !ctx.aiReviewed
        ? { status: 'not_assessed', detail: NO_AI }
        : zeroOf(
            securityFindings(ctx, /auth|jwt|session|csrf|permission|access control|privilege|idor|token/i),
            findingEvidence,
            'auth/access-control finding',
            'AI review found no authentication or authorization weaknesses.',
          ),
  },
  {
    id: 'appsec.semgrep',
    title: 'Static security rules (Semgrep) pass',
    domainId: 'appsec',
    severity: 'medium',
    businessImpact: 'Rule-based scanners catch the well-known insecure patterns auditors and pen-testers look for first.',
    run: (ctx) =>
      !ctx.semgrepRan
        ? { status: 'not_assessed', detail: 'Semgrep did not run on this scan.' }
        : zeroOf(ctx.semgrep, hitEvidence, 'Semgrep match', 'No Semgrep rule matched.'),
  },

  // --- Secrets & credentials ------------------------------------------------
  {
    id: 'secrets.none',
    title: 'No hardcoded secrets in the repository',
    domainId: 'secrets',
    severity: 'critical',
    businessImpact: 'Anyone with repository access — past staff, contractors, a leaked laptop — can use these credentials against production.',
    run: (ctx) => {
      if (ctx.input.secrets == null) return { status: 'not_assessed', detail: 'Secret scanning did not run on this scan.' };
      const secrets = asArray(ctx.input.secrets) as Array<Record<string, unknown>>;
      // Path, line and rule only — never the matched snippet, which is the secret itself.
      return zeroOf(secrets, (s) => s.map((x) => ({ path: str(x.path), line: num(x.line), note: str(x.rule) })), 'potential secret', 'Secret scan found no credentials in source.');
    },
  },
  {
    id: 'secrets.private_keys',
    title: 'No private keys committed',
    domainId: 'secrets',
    severity: 'critical',
    businessImpact: 'A committed private key (service account, TLS, signing) grants the holder the identity of the company’s systems.',
    run: (ctx) => {
      if (ctx.input.secrets == null) return { status: 'not_assessed', detail: 'Secret scanning did not run on this scan.' };
      const keys = (asArray(ctx.input.secrets) as Array<Record<string, unknown>>).filter((s) => str(s.rule) === 'Private Key');
      return zeroOf(keys, (s) => s.map((x) => ({ path: str(x.path), line: num(x.line), note: 'Private key material' })), 'private key', 'No private key material found.');
    },
  },
  {
    id: 'secrets.cloud_tokens',
    title: 'No cloud or payment provider tokens',
    domainId: 'secrets',
    severity: 'critical',
    businessImpact: 'Live AWS, Stripe, GitHub or Slack tokens give direct access to infrastructure, money movement or source code.',
    run: (ctx) => {
      if (ctx.input.secrets == null) return { status: 'not_assessed', detail: 'Secret scanning did not run on this scan.' };
      const providerRules = ['AWS Access Key', 'Slack Token', 'Stripe Live Key', 'GitHub Token'];
      const hits = (asArray(ctx.input.secrets) as Array<Record<string, unknown>>).filter((s) => providerRules.includes(str(s.rule)));
      return zeroOf(hits, (s) => s.map((x) => ({ path: str(x.path), line: num(x.line), note: str(x.rule) })), 'provider token', 'No AWS, Stripe, GitHub or Slack tokens found.');
    },
  },
  {
    id: 'secrets.code_credentials',
    title: 'No credentials assigned in code',
    domainId: 'secrets',
    severity: 'high',
    businessImpact: 'Passwords in code can’t be rotated without a deploy and end up in every copy of the codebase.',
    run: (ctx) =>
      !ctx.hasPython
        ? { status: 'not_assessed', detail: 'Applies to Python code; none was analyzed.' }
        : zeroOf(rules(ctx, ['python/hardcoded-credential', 'python/hardcoded-secret']), hitEvidence, 'hardcoded credential', 'No credentials assigned as literals.'),
  },

  // --- Configuration & environment -----------------------------------------
  {
    id: 'config.env_files',
    title: 'No environment files committed',
    domainId: 'config',
    severity: 'high',
    businessImpact: '.env files usually hold every production credential at once; committing them exposes the whole stack.',
    run: (ctx) => {
      const envFiles = ctx.knownPaths.filter((p) => /(^|\/)\.env(\.[\w-]+)?$/.test(p) && !/\.(example|sample|template)$/.test(p));
      // The full file listing isn't retained, so absence can't be proven — this check can only fail.
      if (envFiles.length === 0) return { status: 'not_assessed', detail: 'No .env file surfaced, but the full file listing isn’t retained to confirm absence.' };
      return { status: 'fail', detail: `${plural(envFiles.length, 'environment file')} committed to the repository.`, evidence: envFiles.map((p) => ({ path: p, line: null, note: 'Committed environment file' })) };
    },
  },
  {
    id: 'config.debug',
    title: 'Debug and auto-reload disabled',
    domainId: 'config',
    severity: 'medium',
    businessImpact: 'Debug mode in production leaks stack traces and internals that make attacks easier.',
    run: (ctx) =>
      !ctx.hasPython
        ? { status: 'not_assessed', detail: 'Applies to Python web frameworks; no Python code was analyzed.' }
        : zeroOf(rules(ctx, ['fastapi/debug-mode', 'fastapi/reload-mode']), hitEvidence, 'debug/reload setting', 'No debug or reload flags enabled in code.'),
  },
  {
    id: 'config.database',
    title: 'Database connection configured safely',
    domainId: 'config',
    severity: 'medium',
    businessImpact: 'Echoed SQL or insecure engine settings leak data into logs and weaken production hardening.',
    run: (ctx) =>
      !ctx.hasPython
        ? { status: 'not_assessed', detail: 'Applies to Python ORM configuration; no Python code was analyzed.' }
        : zeroOf(rules(ctx, ['python/sqlalchemy-config']), hitEvidence, 'database configuration issue', 'No risky ORM engine settings found.'),
  },

  // --- Dependency vulnerabilities -------------------------------------------
  ...(['critical', 'high', 'medium'] as const).map(
    (sev): CheckDef => ({
      id: `dependencies.${sev}`,
      title: `No ${sev === 'medium' ? 'moderate' : sev}-severity vulnerable dependencies`,
      domainId: 'dependencies',
      severity: sev,
      businessImpact:
        sev === 'medium'
          ? 'Moderate advisories are routine upkeep, but a long backlog signals dependencies aren’t being maintained.'
          : 'Known-vulnerable packages have public exploits; buyers and their insurers treat them as open security issues.',
      run: (ctx) => {
        if (ctx.input.dependencyVulnerabilities == null) return { status: 'not_assessed', detail: 'Dependency audit did not run on this scan.' };
        const vulns = (asArray(ctx.input.dependencyVulnerabilities) as Array<Record<string, unknown>>).filter((v) => normSeverity(v.severity) === sev);
        const byPkg = new Map<string, number>();
        for (const v of vulns) byPkg.set(str(v.package), (byPkg.get(str(v.package)) ?? 0) + 1);
        if (byPkg.size === 0) return { status: 'pass', detail: `No ${sev === 'medium' ? 'moderate' : sev}-severity advisories.` };
        return {
          status: 'fail',
          detail: `${plural(vulns.length, 'advisory')} across ${plural(byPkg.size, 'package')}.`,
          evidence: [...byPkg.entries()].map(([pkg, n]) => ({ path: pkg, line: null, note: plural(n, 'advisory') })),
        };
      },
    }),
  ),

  // --- License compliance ---------------------------------------------------
  ...(
    [
      ['high', 'license.copyleft', 'No strong-copyleft dependencies', 'Strong copyleft (GPL/AGPL) can oblige the company to publish its own source code — a direct hit to IP value.'],
      ['medium', 'license.weak_copyleft', 'No weak-copyleft dependencies', 'Weak copyleft (LGPL/MPL) is usable but carries obligations that need legal review before distribution.'],
      ['low', 'license.identified', 'Every dependency license identified', 'Unknown licenses are unpriced legal risk until someone confirms the terms.'],
    ] as const
  ).map(
    ([level, id, title, impact]): CheckDef => ({
      id,
      title,
      domainId: 'licenses',
      severity: level,
      businessImpact: impact,
      run: (ctx) => {
        if (ctx.input.licenseFindings == null) return { status: 'not_assessed', detail: 'License audit did not run on this scan.' };
        const hits = (asArray(ctx.input.licenseFindings) as Array<Record<string, unknown>>).filter((l) => l.riskLevel === level);
        return zeroOf(
          hits,
          (h) => h.map((l) => ({ path: `${str(l.package)}@${str(l.version)}`, line: null, note: `${str(l.license)} — ${str(l.reason)}` })),
          'dependency',
          'None found.',
        );
      },
    }),
  ),

  // --- Code correctness -----------------------------------------------------
  {
    id: 'correctness.compile',
    title: 'TypeScript compiles without errors',
    domainId: 'correctness',
    severity: 'high',
    businessImpact: 'Code that doesn’t type-check is code nobody has shipped as written — a sign of broken builds or unreviewed changes.',
    run: (ctx) =>
      !ctx.hasTs
        ? { status: 'not_assessed', detail: 'Applies to TypeScript; none was analyzed.' }
        : zeroOf(ctx.tsDiagnostics, hitEvidence, 'compile error', 'No TypeScript compiler errors.'),
  },
  {
    id: 'correctness.lint',
    title: 'No lint errors',
    domainId: 'correctness',
    severity: 'medium',
    businessImpact: 'Lint errors are cheap defects left unfixed; a high count suggests weak review discipline.',
    run: (ctx) =>
      !ctx.hasJsTs
        ? { status: 'not_assessed', detail: 'Applies to JavaScript/TypeScript; none was analyzed.' }
        : zeroOf(ctx.lint.filter((l) => l.severity === 'error'), hitEvidence, 'lint error', 'No lint errors.'),
  },
  {
    id: 'correctness.logic',
    title: 'No high-severity logic defects',
    domainId: 'correctness',
    severity: 'high',
    businessImpact: 'Logic defects cause wrong results in production — billing errors, data corruption, silent failures customers notice first.',
    run: (ctx) =>
      !ctx.aiReviewed
        ? { status: 'not_assessed', detail: NO_AI }
        : zeroOf(
            ctx.findings.filter((f) => f.category === 'Logic' && (f.severity === 'critical' || f.severity === 'high') && f.title !== 'TypeScript compile error'),
            findingEvidence,
            'logic defect',
            'AI review found no high-severity logic defects.',
          ),
  },

  // --- Complexity & maintainability -----------------------------------------
  {
    id: 'complexity.extreme',
    title: 'No extremely complex functions (complexity > 20)',
    domainId: 'complexity',
    severity: 'medium',
    businessImpact: 'Functions this tangled are where bugs hide and where new engineers lose weeks; they slow every future change.',
    run: (ctx) =>
      ctx.functions.length === 0
        ? { status: 'not_assessed', detail: 'No function-level metrics were extracted on this scan.' }
        : zeroOf(
            ctx.functions.filter((f) => f.complexity > 20).sort((a, b) => b.complexity - a.complexity),
            (fns) => fns.map((f) => ({ path: f.path, line: f.line, note: `${f.name}() — complexity ${f.complexity}` })),
            'function',
            `All ${ctx.functions.length} measured functions are at complexity 20 or below.`,
          ),
  },
  {
    id: 'complexity.share',
    title: 'Under 10% of functions above complexity 10',
    domainId: 'complexity',
    severity: 'low',
    businessImpact: 'A high share of complex functions means maintenance cost grows faster than the product does.',
    run: (ctx) => {
      if (ctx.functions.length === 0) return { status: 'not_assessed', detail: 'No function-level metrics were extracted on this scan.' };
      const over = ctx.functions.filter((f) => f.complexity > 10);
      const share = over.length / ctx.functions.length;
      const detail = `${over.length} of ${ctx.functions.length} functions (${Math.round(share * 100)}%) exceed complexity 10.`;
      return share < 0.1
        ? { status: 'pass', detail }
        : { status: 'fail', detail, evidence: over.map((f) => ({ path: f.path, line: f.line, note: `${f.name}() — complexity ${f.complexity}` })) };
    },
  },
  {
    id: 'complexity.maintainability',
    title: 'No high-severity maintainability issues',
    domainId: 'complexity',
    severity: 'medium',
    businessImpact: 'Maintainability problems flagged in review translate directly into slower roadmap delivery after the deal.',
    run: (ctx) =>
      !ctx.aiReviewed
        ? { status: 'not_assessed', detail: NO_AI }
        : zeroOf(
            ctx.findings.filter((f) => f.category === 'Maintainability' && (f.severity === 'critical' || f.severity === 'high')),
            findingEvidence,
            'maintainability issue',
            'AI review found no high-severity maintainability issues.',
          ),
  },

  // --- Duplication & dead code ----------------------------------------------
  {
    id: 'duplication.blocks',
    title: 'Five or fewer duplicated code blocks',
    domainId: 'duplication',
    severity: 'low',
    businessImpact: 'Copy-pasted logic must be fixed in several places; missed copies become recurring bugs.',
    run: (ctx) => {
      if (ctx.input.duplicates == null) return { status: 'not_assessed', detail: 'Duplicate detection did not run on this scan.' };
      const groups = asArray(ctx.input.duplicates) as Array<{ linesOfCode?: unknown; occurrences?: unknown }>;
      const detail = `${plural(groups.length, 'duplicated block')} found.`;
      if (groups.length <= 5) return { status: 'pass', detail };
      return {
        status: 'fail',
        detail,
        evidence: groups.map((g) => {
          const occ = asArray(g.occurrences) as Array<{ path?: unknown; startLine?: unknown }>;
          return { path: str(occ[0]?.path), line: num(occ[0]?.startLine), note: `${num(g.linesOfCode) ?? '?'} lines repeated ${occ.length}×` };
        }),
      };
    },
  },
  {
    id: 'duplication.dead_code',
    title: 'Five or fewer unreferenced files',
    domainId: 'duplication',
    severity: 'low',
    businessImpact: 'Dead code inflates the codebase a buyer is paying for and confuses new engineers.',
    run: (ctx) => {
      if (ctx.input.deadCode == null || graphEntries(ctx).length === 0) return { status: 'not_assessed', detail: NO_GRAPH };
      const dead = asArray(ctx.input.deadCode).map(str).filter(Boolean);
      const detail = `${plural(dead.length, 'possibly dead file')} found.`;
      return dead.length <= 5 ? { status: 'pass', detail } : { status: 'fail', detail, evidence: dead.map((p) => ({ path: p, line: null, note: 'Not imported anywhere' })) };
    },
  },

  // --- Architecture consistency ---------------------------------------------
  {
    id: 'consistency.score',
    title: 'Architecture consistency score of 70 or higher',
    domainId: 'consistency',
    severity: 'medium',
    businessImpact: 'Inconsistent conventions make the codebase expensive to extend and hard to hand to a new team.',
    run: (ctx) => {
      const a = ctx.input.architectureAssessment as { consistencyScore?: unknown } | null;
      const score = num(a?.consistencyScore);
      if (score === null) return { status: 'not_assessed', detail: 'Architecture assessment runs only when a scan already needed AI review.' };
      return { status: score >= 70 ? 'pass' : 'fail', detail: `Consistency score ${score}/100.`, severity: score < 40 ? 'high' : 'medium' };
    },
  },
  {
    id: 'consistency.inconsistencies',
    title: 'Two or fewer cross-cutting inconsistencies',
    domainId: 'consistency',
    severity: 'low',
    businessImpact: 'Each competing pattern (two ways to call the DB, three error styles) multiplies onboarding and refactoring cost.',
    run: (ctx) => {
      const a = ctx.input.architectureAssessment as { inconsistencies?: unknown } | null;
      if (!a || !Array.isArray(a.inconsistencies)) return { status: 'not_assessed', detail: 'Architecture assessment runs only when a scan already needed AI review.' };
      const items = a.inconsistencies as Array<{ title?: unknown; files?: unknown }>;
      const detail = `${plural(items.length, 'inconsistency')} identified.`;
      if (items.length <= 2) return { status: 'pass', detail };
      return { status: 'fail', detail, evidence: items.map((i) => ({ path: str(asArray(i.files)[0]) || 'multiple files', line: null, note: str(i.title) })) };
    },
  },

  // --- Modularity & coupling ------------------------------------------------
  {
    id: 'modularity.circular',
    title: 'No circular imports',
    domainId: 'modularity',
    severity: 'medium',
    businessImpact: 'Circular dependencies make modules impossible to change or extract independently — a blocker for scaling the team.',
    run: (ctx) => {
      if (ctx.input.circularImports == null || graphEntries(ctx).length === 0) return { status: 'not_assessed', detail: NO_GRAPH };
      const cycles = asArray(ctx.input.circularImports).map((c) => asArray(c).map(str));
      return zeroOf(cycles, (cs) => cs.map((c) => ({ path: c[0] ?? '', line: null, note: c.join(' → ') })), 'circular import chain', 'Import graph is acyclic.');
    },
  },
  {
    id: 'modularity.fan_out',
    title: 'No module imports more than 15 internal modules',
    domainId: 'modularity',
    severity: 'low',
    businessImpact: 'Modules that depend on everything break whenever anything changes, slowing safe releases.',
    run: (ctx) => {
      const entries = graphEntries(ctx);
      if (entries.length === 0) return { status: 'not_assessed', detail: NO_GRAPH };
      const heavy = entries.map(([p, deps]) => ({ p, n: asArray(deps).length })).filter((e) => e.n > 15).sort((a, b) => b.n - a.n);
      return zeroOf(heavy, (h) => h.map((e) => ({ path: e.p, line: null, note: `imports ${e.n} internal modules` })), 'over-coupled module', `All ${entries.length} modules import 15 or fewer internal modules.`);
    },
  },
  {
    id: 'modularity.design',
    title: 'No high-severity design flaws',
    domainId: 'modularity',
    severity: 'medium',
    businessImpact: 'Structural design flaws are the most expensive kind of debt — they usually need a rewrite, not a patch.',
    run: (ctx) =>
      !ctx.aiReviewed
        ? { status: 'not_assessed', detail: NO_AI }
        : zeroOf(
            ctx.findings.filter((f) => f.category === 'Architecture' && (f.severity === 'critical' || f.severity === 'high')),
            findingEvidence,
            'design flaw',
            'AI review found no high-severity design flaws.',
          ),
  },

  // --- Performance ----------------------------------------------------------
  {
    id: 'performance.findings',
    title: 'No high-severity performance problems',
    domainId: 'performance',
    severity: 'medium',
    businessImpact: 'Performance problems show up as infrastructure cost and churn once usage grows after the deal.',
    run: (ctx) =>
      !ctx.aiReviewed
        ? { status: 'not_assessed', detail: NO_AI }
        : zeroOf(
            ctx.findings.filter((f) => f.category === 'Performance' && (f.severity === 'critical' || f.severity === 'high')),
            findingEvidence,
            'performance problem',
            'AI review found no high-severity performance problems.',
          ),
  },

  // --- Test coverage --------------------------------------------------------
  {
    id: 'testing.ratio',
    title: 'At least one test file per five source files',
    domainId: 'testing',
    severity: 'high',
    businessImpact: 'Without tests, every change risks a regression — the team ships slower and buyers inherit the risk.',
    run: (ctx) => {
      const t = ctx.input.testCoverage as { testFileRatio?: unknown; testFileCount?: unknown; sourceFileCount?: unknown } | null;
      const ratio = num(t?.testFileRatio);
      if (ratio === null) return { status: 'not_assessed', detail: 'Test-coverage estimate is not available for this scan.' };
      const detail = `${num(t?.testFileCount) ?? 0} test files for ${num(t?.sourceFileCount) ?? 0} source files (ratio ${ratio}).`;
      return { status: ratio >= 0.2 ? 'pass' : 'fail', detail, severity: ratio < 0.05 ? 'high' : 'medium' };
    },
  },
  {
    id: 'testing.coverage_config',
    title: 'Coverage measurement configured',
    domainId: 'testing',
    severity: 'low',
    businessImpact: 'If nobody measures coverage, nobody knows which parts of the product are unprotected.',
    run: (ctx) => {
      const t = ctx.input.testCoverage as { hasCoverageConfig?: unknown } | null;
      if (typeof t?.hasCoverageConfig !== 'boolean') return { status: 'not_assessed', detail: 'Test-coverage estimate is not available for this scan.' };
      return t.hasCoverageConfig ? { status: 'pass', detail: 'Coverage tooling configuration found.' } : { status: 'fail', detail: 'No coverage tooling configuration found.' };
    },
  },
  {
    id: 'testing.untested_dirs',
    title: 'Every top-level source directory has tests',
    domainId: 'testing',
    severity: 'medium',
    businessImpact: 'Entire untested modules are where post-close incidents tend to come from.',
    run: (ctx) => {
      const t = ctx.input.testCoverage as { untestedDirectories?: unknown } | null;
      if (!t || !Array.isArray(t.untestedDirectories)) return { status: 'not_assessed', detail: 'Test-coverage estimate is not available for this scan.' };
      const dirs = t.untestedDirectories.map(str).filter(Boolean);
      return zeroOf(dirs, (d) => d.map((p) => ({ path: p === '.' ? '(repository root)' : `${p}/`, line: null, note: 'Source files with no tests' })), 'untested directory', 'Every source directory contains tests.');
    },
  },

  // --- CI & delivery --------------------------------------------------------
  {
    id: 'delivery.ci_tests',
    title: 'CI pipeline runs the test suite',
    domainId: 'delivery',
    severity: 'medium',
    businessImpact: 'Without tests in CI, broken code reaches production as soon as someone forgets to run them locally.',
    run: (ctx) => {
      const t = ctx.input.testCoverage as { hasCiTestStep?: unknown } | null;
      if (typeof t?.hasCiTestStep !== 'boolean') return { status: 'not_assessed', detail: 'CI configuration was not inspected on this scan.' };
      return t.hasCiTestStep ? { status: 'pass', detail: 'A CI workflow runs tests.' } : { status: 'fail', detail: 'No CI workflow step runs tests.' };
    },
  },

  // --- Knowledge concentration ----------------------------------------------
  {
    id: 'concentration.top_share',
    title: 'No contributor authored half or more of all commits',
    domainId: 'concentration',
    severity: 'high',
    businessImpact: 'When one person wrote most of the code, their departure stalls the roadmap — a key-person risk to price into the deal.',
    run: (ctx) => {
      const stats = contributors(ctx);
      if (!stats) return { status: 'not_assessed', detail: 'No contributor history (zip uploads carry no git history).' };
      const total = stats.reduce((s, c) => s + c.commits, 0);
      const share = stats[0].commits / total;
      const detail = `${stats[0].author} authored ${Math.round(share * 100)}% of ${total} commits.`;
      return share < 0.5
        ? { status: 'pass', detail }
        : { status: 'fail', detail, evidence: [{ path: stats[0].author, line: null, note: `${stats[0].commits} of ${total} commits` }] };
    },
  },
  {
    id: 'concentration.bus_factor',
    title: 'At least three significant contributors (≥10% of commits each)',
    domainId: 'concentration',
    severity: 'medium',
    businessImpact: 'A bus factor of one or two means knowledge isn’t spread enough to survive normal staff turnover.',
    run: (ctx) => {
      const stats = contributors(ctx);
      if (!stats) return { status: 'not_assessed', detail: 'No contributor history (zip uploads carry no git history).' };
      const total = stats.reduce((s, c) => s + c.commits, 0);
      const significant = stats.filter((c) => c.commits / total >= 0.1);
      const detail = `${plural(significant.length, 'contributor')} with 10% or more of commits.`;
      return significant.length >= 3
        ? { status: 'pass', detail }
        : { status: 'fail', detail, evidence: significant.map((c) => ({ path: c.author, line: null, note: `${Math.round((c.commits / total) * 100)}% of commits` })) };
    },
  },

  // --- Development continuity -----------------------------------------------
  {
    id: 'continuity.recent_activity',
    title: `Commits within ${ACTIVE_WINDOW_DAYS} days of the scan`,
    domainId: 'continuity',
    severity: 'medium',
    businessImpact: 'A dormant codebase may have no one left who can maintain it.',
    run: (ctx) => {
      const stats = contributors(ctx);
      const dated = stats?.filter((c) => c.lastCommitAt) ?? [];
      if (!ctx.scannedAt || dated.length === 0) return { status: 'not_assessed', detail: 'No commit dates were available.' };
      const latest = dated.reduce((a, b) => (a.lastCommitAt! > b.lastCommitAt! ? a : b));
      const age = daysBetween(ctx.scannedAt, latest.lastCommitAt!);
      return { status: age <= ACTIVE_WINDOW_DAYS ? 'pass' : 'fail', detail: `Most recent commit ${age} days before the scan (${latest.author}).` };
    },
  },
  {
    id: 'continuity.top_active',
    title: 'Primary author still active',
    domainId: 'continuity',
    severity: 'high',
    businessImpact: 'If the person who wrote most of the code has stopped committing, critical knowledge may already have left.',
    run: (ctx) => {
      const stats = contributors(ctx);
      if (!ctx.scannedAt || !stats || !stats[0].lastCommitAt) return { status: 'not_assessed', detail: 'No commit dates were available.' };
      const top = stats[0];
      const age = daysBetween(ctx.scannedAt, top.lastCommitAt!);
      const detail = `${top.author} (top contributor) last committed ${age} days before the scan.`;
      return age <= ACTIVE_WINDOW_DAYS
        ? { status: 'pass', detail }
        : { status: 'fail', detail, evidence: [{ path: top.author, line: null, note: `Last commit ${top.lastCommitAt!.toISOString().slice(0, 10)}` }] };
    },
  },
  {
    id: 'continuity.active_team',
    title: `Two or more contributors active in the last ${ACTIVE_WINDOW_DAYS} days`,
    domainId: 'continuity',
    severity: 'medium',
    businessImpact: 'A single active maintainer is a single point of failure for every fix after close.',
    run: (ctx) => {
      const stats = contributors(ctx);
      const dated = stats?.filter((c) => c.lastCommitAt) ?? [];
      if (!ctx.scannedAt || dated.length === 0) return { status: 'not_assessed', detail: 'No commit dates were available.' };
      const active = dated.filter((c) => daysBetween(ctx.scannedAt!, c.lastCommitAt!) <= ACTIVE_WINDOW_DAYS);
      const detail = `${plural(active.length, 'contributor')} committed in the ${ACTIVE_WINDOW_DAYS} days before the scan.`;
      return active.length >= 2 ? { status: 'pass', detail } : { status: 'fail', detail, evidence: active.map((c) => ({ path: c.author, line: null, note: 'Recently active' })) };
    },
  },
];

export const TDD_CHECK_CATALOG_SIZE = CHECKS.length;

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------

const RATING_RANK: Record<TddRating, number> = { not_assessed: -1, pass: 0, low: 1, medium: 2, high: 3, critical: 4 };

function rollUp(checks: TddCheck[]): { rating: TddRating; checksRun: number; checksPassed: number } {
  const run = checks.filter((c) => c.status !== 'not_assessed');
  if (run.length === 0) return { rating: 'not_assessed', checksRun: 0, checksPassed: 0 };
  let rating: TddRating = 'pass';
  for (const c of run) if (c.status === 'fail' && RATING_RANK[c.severity] > RATING_RANK[rating]) rating = c.severity;
  return { rating, checksRun: run.length, checksPassed: run.filter((c) => c.status === 'pass').length };
}

// Which remediation workstream (aggregateRisk's item categories) belongs to
// which area, and how urgently. Secrets and exploitable security issues are
// conditions of close; supply-chain fixes are quick wins for the first
// month; structural work is a 90-day plan.
const WORKSTREAM_PLAN: Record<string, { areaId: string; phase: RemediationPhase }> = {
  'Security findings': { areaId: 'security', phase: 'pre_close' },
  'Exposed secrets': { areaId: 'security', phase: 'pre_close' },
  'Dependency vulnerabilities': { areaId: 'supply_chain', phase: 'days_30' },
  'License compliance': { areaId: 'supply_chain', phase: 'pre_close' },
  'Structural debt': { areaId: 'tech_debt', phase: 'days_90' },
  'Test coverage': { areaId: 'engineering', phase: 'days_90' },
  'Architecture inconsistencies': { areaId: 'architecture', phase: 'days_90' },
};

function areaHeadline(checks: TddCheck[], rollup: ReturnType<typeof rollUp>): string {
  if (rollup.checksRun === 0) return 'Not assessed on this scan.';
  const failed = checks.filter((c) => c.status === 'fail').sort((a, b) => RATING_RANK[b.severity] - RATING_RANK[a.severity]);
  if (failed.length === 0) return rollup.checksRun === 1 ? 'The one check run passed.' : `All ${rollup.checksRun} checks passed.`;
  return failed[0].detail;
}

export function assessTdd(input: TddInput, risk: RiskAggregation): TddAssessment {
  const ctx = buildContext(input);

  const checks: TddCheck[] = CHECKS.map((def) => {
    const out = def.run(ctx);
    const evidence = out.status === 'not_assessed' ? [] : (out.evidence ?? []).slice(0, MAX_EVIDENCE);
    const severity = out.status !== 'not_assessed' && out.severity ? out.severity : def.severity;
    return { id: def.id, title: def.title, domainId: def.domainId, status: out.status, severity, detail: out.detail, businessImpact: def.businessImpact, evidence };
  });

  const domains: TddDomain[] = TDD_DOMAINS.map((d) => ({ ...d, ...rollUp(checks.filter((c) => c.domainId === d.id)) }));

  const areas: TddArea[] = TDD_AREAS.map((a) => {
    const domainIds = TDD_DOMAINS.filter((d) => d.areaId === a.id).map((d) => d.id);
    const areaChecks = checks.filter((c) => domainIds.includes(c.domainId));
    const rollup = rollUp(areaChecks);
    return { ...a, ...rollup, headline: areaHeadline(areaChecks, rollup) };
  });

  const run = checks.filter((c) => c.status !== 'not_assessed');
  const failed = run.filter((c) => c.status === 'fail');
  const riskCounts: Record<CheckSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const c of failed) riskCounts[c.severity]++;

  // Day estimates come straight from aggregateRisk so the plan here and the
  // headline remediation figure can never disagree.
  const phaseOrder: RemediationPhase[] = ['pre_close', 'days_30', 'days_90'];
  const steps: TddRemediationStep[] = risk.remediation.items
    .map((item) => {
      const plan = WORKSTREAM_PLAN[item.category] ?? { areaId: 'tech_debt', phase: 'days_90' };
      return {
        ...plan,
        category: item.category,
        description: item.description,
        estimatedDays: item.estimatedDays,
        costLowUsd: Math.round(item.estimatedDays * DAY_RATE_LOW_USD),
        costHighUsd: Math.round(item.estimatedDays * DAY_RATE_HIGH_USD),
      };
    })
    .sort((a, b) => phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase) || b.estimatedDays - a.estimatedDays);

  const byPhase = Object.fromEntries(
    phaseOrder.map((p) => {
      const inPhase = steps.filter((s) => s.phase === p);
      const sum = (f: (s: TddRemediationStep) => number) => inPhase.reduce((acc, s) => acc + f(s), 0);
      return [p, { days: Math.round(sum((s) => s.estimatedDays) * 100) / 100, costLowUsd: sum((s) => s.costLowUsd), costHighUsd: sum((s) => s.costHighUsd) }];
    }),
  ) as TddAssessment['remediationPlan']['byPhase'];

  return {
    areas,
    domains,
    checks,
    coverage: {
      catalogSize: CHECKS.length,
      checksRun: run.length,
      checksPassed: run.length - failed.length,
      checksFailed: failed.length,
      notAssessed: CHECKS.length - run.length,
      filesAnalyzed: num(input.filesScanned) ?? input.files.length,
      filesInRepository: num(input.fileCount) ?? input.files.length,
    },
    riskCounts,
    remediationPlan: { steps, byPhase },
  };
}
