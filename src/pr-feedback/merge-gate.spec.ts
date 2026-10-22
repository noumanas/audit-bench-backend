import { assessMergeReadiness, PrSnapshot } from '../common/merge-readiness';
import { reconcileReadiness } from './pr-insights';

const pr: PrSnapshot = {
  owner: 'a', repo: 'b', number: 1, title: 't', url: 'u', state: 'open', merged: false, draft: false,
  mergeable: true, mergeableState: 'clean', baseRef: 'main', headRef: 'f', headSha: 's', additions: 1, deletions: 1,
  changedFiles: 1, commits: 1, checks: { passed: 2, failed: [], pending: [] }, filesReviewed: 1, filesSkipped: 0, fetchedAt: '',
};
const none = { critical: 0, high: 0, medium: 0, low: 0 };

describe('merge readiness blocks on serious security problems', () => {
  it('blocks a high-severity security issue (e.g. SQL injection rated high)', () => {
    const r = assessMergeReadiness(pr, { verdict: 'needs_work', findings: { ...none, high: 1 }, highSecurity: 1, secrets: 0 });
    expect(r.status).toBe('not_ready');
    expect(r.blockers).toEqual(['1 high-severity security issue in the changed lines.']);
  });

  it('keeps other high-severity findings as notes', () => {
    const r = assessMergeReadiness(pr, { verdict: 'needs_work', findings: { ...none, high: 1 }, highSecurity: 0, secrets: 0 });
    expect(r.status).toBe('ready_with_notes');
  });
});

describe('reconcileReadiness', () => {
  const ready = { status: 'ready' as const, blockers: [], notes: [] };

  it("won't say a plain 'ready' when checks below it warn", () => {
    const r = reconcileReadiness(ready, [
      { name: 'CI checks', status: 'warning', explanation: 'No CI checks ran on this commit.' },
      { name: 'Secrets', status: 'pass', explanation: 'None.' },
    ]);
    expect(r).toEqual({ status: 'ready_with_notes', blockers: [], notes: ['CI checks: No CI checks ran on this commit.'] });
  });

  it('turns a failing check into a blocker', () => {
    const r = reconcileReadiness(ready, [{ name: 'Secrets', status: 'fail', explanation: '1 possible secret added.' }]);
    expect(r?.status).toBe('not_ready');
  });

  it('stays ready when every check passes', () => {
    expect(reconcileReadiness(ready, [{ name: 'Tests', status: 'pass', explanation: 'ok' }])).toEqual(ready);
  });
});
