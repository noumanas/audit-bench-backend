import { buildSummaryBody } from './summary-comment';
import { deterministicChecks } from './pr-insights';
import { PrSnapshot } from '../common/merge-readiness';

const snapshot: PrSnapshot = {
  owner: 'acme',
  repo: 'api',
  number: 9,
  title: 'Restore spelling menus',
  body: 'Fixes #31070',
  url: 'https://github.com/acme/api/pull/9',
  state: 'open',
  merged: false,
  draft: false,
  mergeable: true,
  mergeableState: 'clean',
  baseRef: 'main',
  headRef: 'fix/menus',
  headSha: 'dc6b5aa111',
  additions: 120,
  deletions: 30,
  changedFiles: 3,
  commits: 2,
  checks: { passed: 5, failed: ['tests (3.11)'], pending: [] },
  filesReviewed: 3,
  filesSkipped: 0,
  fetchedAt: '2026-10-21T00:00:00Z',
};

describe('deterministicChecks', () => {
  it('reports conflicts, CI, secrets, blocking issues, tests and size from GitHub state and findings', () => {
    const checks = deterministicChecks(snapshot, {
      findings: [{ severity: 'high' }],
      secrets: 0,
      changedPaths: ['src/menu.ts', 'src/preload.ts'],
    });
    const byName = Object.fromEntries(checks.map((c) => [c.name, c.status]));
    expect(byName).toEqual({
      'Merge conflicts': 'pass',
      'CI checks': 'fail',
      Secrets: 'pass',
      'Blocking issues': 'warning',
      Tests: 'warning',
      'PR size': 'pass',
    });
    expect(checks.find((c) => c.name === 'CI checks')!.explanation).toBe('1 of 6 failing: tests (3.11).');
  });

  it('passes the tests check when test files changed too, and skips conflicts once merged', () => {
    const checks = deterministicChecks(
      { ...snapshot, state: 'closed', merged: true },
      { findings: [], secrets: 0, changedPaths: ['src/menu.ts', 'src/menu.test.ts'] },
    );
    expect(checks.find((c) => c.name === 'Tests')!.status).toBe('pass');
    expect(checks.some((c) => c.name === 'Merge conflicts')).toBe(false);
  });
});

describe('buildSummaryBody', () => {
  const base = {
    verdict: 'needs_work' as const,
    summary: 'Reviewed 3/3 files.',
    scanUrl: 'https://auditbenchai.com/app/repository/1',
    headSha: 'dc6b5aa111',
    findings: [
      { path: 'src/menu.ts', line: 10, endLine: 12, severity: 'high', title: 'Menu leaks', description: 'd', suggestedFix: 'f' },
    ],
    readiness: { status: 'not_ready' as const, blockers: ['1 CI check failing: tests (3.11).'], notes: [] },
    checks: deterministicChecks(snapshot, { findings: [{ severity: 'high' }], secrets: 0, changedPaths: ['src/menu.ts'] }),
    insights: {
      walkthrough: 'Restores native spelling menus in editable chat fields.',
      files: [{ path: 'src/menu.ts', summary: 'Routes the context menu | keeps native items.' }],
      mergeRisk: { level: 'minimal' as const, explanation: 'No merge-blocking risk found.' },
      checks: [
        { name: 'Title check' as const, status: 'pass' as const, explanation: 'Clear title.' },
        { name: 'Description check' as const, status: 'warning' as const, explanation: 'No test notes.', resolution: 'Say how it was tested.' },
      ],
    },
  };

  it('lays the comment out like a reviewer bot: button, count, risk, checks, walkthrough, info, prompt, thanks', () => {
    const body = buildSummaryBody(base, { posted: 1 });
    const order = [
      '<!-- audit-bench:summary -->',
      '[![Open in Audit Bench Ai](',
      '**Actionable comments posted: 1**',
      '<summary><b>Merge risk:</b> ⚪ Minimal · up to <code>dc6b5aa</code></summary>',
      '**Merge readiness:** ⛔ Not ready to merge',
      '<summary><b>Pre-merge checks:</b> ✅ 4 · ❌ 4</summary>',
      '❌ **Failed checks: 1 error, 3 warnings**',
      '| CI checks | ❌ | 1 of 6 failing: tests (3.11). | Open the failing runs on GitHub and fix them before merging. |',
      '| Description check | ⚠️ | No test notes. | Say how it was tested. |',
      '<summary>✅ Passed checks: 4 passed</summary>',
      '<summary>📝 Walkthrough</summary>',
      '| `src/menu.ts` | Routes the context menu \\| keeps native items. |',
      '<summary>ℹ️ Review info</summary>',
      '<summary>🤖 Prompt to fix review comments</summary>',
      'In `@src/menu.ts` around lines 10 - 12: Menu leaks.',
      'Thanks for using [Audit Bench Ai]',
    ];
    let at = -1;
    for (const piece of order) {
      const next = body.indexOf(piece);
      expect({ piece, found: next > at }).toEqual({ piece, found: true });
      at = next;
    }
    expect(body.trim().split('\n').pop()).toMatch(/^<sub>Reviewed by \[Audit Bench Ai\]/);
  });

  it('celebrates a clean review and lists blockers when there is no checks table', () => {
    const body = buildSummaryBody(
      { verdict: 'pass', summary: 's', findings: [], readiness: { status: 'ready_with_notes', blockers: [], notes: ['CI still running.'] } },
      { posted: 0 },
    );
    expect(body).toContain('No actionable comments were generated in this review. 🎉');
    expect(body).toContain('_Worth a look:_\n- CI still running.');
    expect(body).not.toContain('Prompt to fix');
    expect(body).not.toContain('Pre-merge checks');
  });
});
