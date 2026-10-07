import { NotFoundException } from '@nestjs/common';
import { parseGithubRepoUrl } from './github-url';
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

  it('returns 404 once the owner stops sharing', async () => {
    await expect(service({ ...job, isPublic: false }).getShared('abc')).rejects.toThrow(NotFoundException);
  });
});
