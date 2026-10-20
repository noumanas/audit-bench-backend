import { NotFoundException } from '@nestjs/common';
import { parseGithubPrUrl, parseGithubRepoUrl } from '../common/github-url';
import { PrSnapshot, assessMergeReadiness } from '../common/merge-readiness';
import { PublicScanService } from './public-scan.service';

// Same as pipeline.service.spec: the real Stage 1 module loads prettier's ESM-only build, which Jest can't run.
jest.mock('../audit/stage1/run-stage1', () => ({ runStage1: jest.fn() }));

describe('parseGithubRepoUrl', () => {
  it.each([
    ['https://github.com/vercel/next.js', { owner: 'vercel', repo: 'next.js' }],
    ['github.com/vercel/next.js.git', { owner: 'vercel', repo: 'next.js' }],
    ['www.github.com/a/b/', { owner: 'a', repo: 'b' }],
    ['a/b', { owner: 'a', repo: 'b' }],
    ['https://github.com/a/b/tree/feature/x?tab=1', { owner: 'a', repo: 'b', ref: 'feature/x' }],
  ])('parses %s', (input, expected) => {
    expect(parseGithubRepoUrl(input)).toEqual(expected);
  });

  it.each(['', 'https://gitlab.com/a/b', 'just-a-name', 'github.com/a', 'github.com/../b'])('rejects %s', (input) => {
    expect(parseGithubRepoUrl(input)).toBeNull();
  });
});

describe('parseGithubPrUrl', () => {
  it.each([
    ['https://github.com/Netflix/metaflow/pull/3332', { owner: 'Netflix', repo: 'metaflow', number: 3332 }],
    ['github.com/a/b/pull/7/files?diff=split', { owner: 'a', repo: 'b', number: 7 }],
    ['www.github.com/a/b.js/pull/12#discussion_r1', { owner: 'a', repo: 'b.js', number: 12 }],
    ['a/b#42', { owner: 'a', repo: 'b', number: 42 }],
  ])('parses %s', (input, expected) => {
    expect(parseGithubPrUrl(input)).toEqual(expected);
  });

  it.each(['https://github.com/a/b', 'github.com/a/b/issues/3', 'github.com/a/b/pull/x', 'gitlab.com/a/b/pull/1', 'a/b#0', '../b#1'])(
    'rejects %s',
    (input) => {
      expect(parseGithubPrUrl(input)).toBeNull();
    },
  );
});

describe('assessMergeReadiness', () => {
  const pr: PrSnapshot = {
    owner: 'a',
    repo: 'b',
    number: 1,
    title: 't',
    url: 'u',
    state: 'open',
    merged: false,
    draft: false,
    mergeable: true,
    mergeableState: 'clean',
    baseRef: 'main',
    headRef: 'feature',
    headSha: 'abc',
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    commits: 1,
    checks: { passed: 3, failed: [], pending: [] },
    filesReviewed: 1,
    filesSkipped: 0,
    fetchedAt: '2026-10-20T00:00:00Z',
  };
  const clean = { verdict: 'pass' as const, findings: { critical: 0, high: 0, medium: 0, low: 0 }, secrets: 0 };

  it('is ready when GitHub and the checks are both green', () => {
    expect(assessMergeReadiness(pr, clean)).toEqual({ status: 'ready', blockers: [], notes: [] });
  });

  it('blocks on conflicts, failing CI, drafts, secrets and critical findings', () => {
    const out = assessMergeReadiness(
      { ...pr, draft: true, mergeable: false, mergeableState: 'dirty', checks: { passed: 1, failed: ['test (3.9)', 'lint'], pending: [] } },
      { verdict: 'do_not_ship', findings: { critical: 1, high: 0, medium: 0, low: 0 }, secrets: 1 },
    );
    expect(out.status).toBe('not_ready');
    expect(out.blockers).toEqual([
      'The pull request is still a draft.',
      'Merge conflicts with main need resolving.',
      '2 CI checks failing: test (3.9), lint.',
      '1 potential secret added in the changed code.',
      '1 critical or high-severity issue in the changed lines.',
    ]);
  });

  it('notes pending checks and minor findings without blocking', () => {
    const out = assessMergeReadiness(
      { ...pr, mergeableState: 'behind', checks: { passed: 1, failed: [], pending: ['build'] }, filesSkipped: 2 },
      { verdict: 'needs_work', findings: { critical: 0, high: 0, medium: 2, low: 1 }, secrets: 0 },
    );
    expect(out.status).toBe('ready_with_notes');
    expect(out.blockers).toEqual([]);
    expect(out.notes).toHaveLength(4);
  });

  it('notes checks GitHub calls unstable even when none are listed', () => {
    const out = assessMergeReadiness({ ...pr, mergeableState: 'unstable' }, clean);
    expect(out).toEqual({
      status: 'ready_with_notes',
      blockers: [],
      notes: ['GitHub reports checks that are failing or waiting for approval to run.'],
    });
  });

  it('reports merged and closed PRs as such', () => {
    expect(assessMergeReadiness({ ...pr, merged: true, state: 'closed' }, clean).status).toBe('merged');
    expect(assessMergeReadiness({ ...pr, state: 'closed' }, clean).status).toBe('closed');
  });
});

describe('PublicScanService.getShared', () => {
  const job = {
    shareId: 'abc',
    isPublic: true,
    status: 'completed',
    sourceName: 'acme/api',
    sourceType: 'github_repo',
    repoRef: { kind: 'github', owner: 'acme', repo: 'api', ref: 'main' },
    secrets: [
      { path: 'config/keys.json', line: 3, rule: 'Private Key', snippet: '-----BEGIN PRIVATE KEY-----abc' },
      { path: '.env', line: 1, rule: 'AWS Access Key', snippet: 'AKIA123' },
    ],
    contributorStats: [
      { author: 'alice-dev', email: 'alice@example.com', commits: 80 },
      { author: 'bob', commits: 20 },
    ],
    files: [],
    dependencyVulnerabilities: [],
    licenseFindings: [],
    circularImports: [],
    deadCode: [],
    duplicates: [],
    testCoverage: null,
    architectureAssessment: null,
    userId: 'u1',
    organizationId: null,
    requesterIpHash: 'hash',
    inputTokens: 999,
  };

  const service = (row: unknown) =>
    new PublicScanService({ scanJob: { findUnique: jest.fn().mockResolvedValue(row) } } as never, {} as never, {} as never);

  it('never exposes secret locations, contributor identities or account details', async () => {
    const out = await service(job).getShared('abc');
    const text = JSON.stringify(out);
    expect(out.secrets).toEqual({ count: 2, types: { 'Private Key': 1, 'AWS Access Key': 1 } });
    expect(out.contributors).toEqual({ count: 2, topSharePct: 80 });
    for (const leak of ['config/keys.json', 'BEGIN PRIVATE KEY', 'AKIA123', 'alice-dev', 'alice@example.com', 'u1', 'hash', '999']) {
      expect(text).not.toContain(leak);
    }
    expect(out.repoUrl).toBe('https://github.com/acme/api');
  });

  it('adds merge readiness for a pull request review and skips repo-wide risk', async () => {
    const pr = {
      ...job,
      sourceName: 'acme/api#9',
      sourceType: 'github_pr',
      repoRef: null,
      contributorStats: null,
      verdict: 'needs_work',
      secrets: [],
      prSnapshot: {
        owner: 'acme',
        repo: 'api',
        number: 9,
        title: 'Add cache',
        url: 'https://github.com/acme/api/pull/9',
        state: 'open',
        merged: false,
        draft: false,
        mergeable: true,
        mergeableState: 'clean',
        baseRef: 'main',
        headRef: 'cache',
        headSha: 'abc',
        additions: 10,
        deletions: 2,
        changedFiles: 1,
        commits: 1,
        checks: { passed: 2, failed: ['tests'], pending: [] },
        filesReviewed: 1,
        filesSkipped: 0,
        fetchedAt: '2026-10-20T00:00:00Z',
      },
      files: [{ path: 'src/cache.ts', language: 'typescript', verdict: 'needs_work', findings: [{ severity: 'medium' }] }],
    };
    const out = await service(pr).getShared('abc');
    expect(out.riskAggregation).toBeNull();
    expect(out.repoUrl).toBe('https://github.com/acme/api');
    expect(out.pullRequest).toMatchObject({
      number: 9,
      readiness: { status: 'not_ready', blockers: ['1 CI check failing: tests.'] },
    });
  });

  it('returns 404 once the owner stops sharing', async () => {
    await expect(service({ ...job, isPublic: false }).getShared('abc')).rejects.toThrow(NotFoundException);
  });
});
