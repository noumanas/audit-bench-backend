import * as crypto from 'crypto';
import { BitbucketService } from './bitbucket.service';
import { parseUnifiedDiff } from '../common/diff-ranges';
import { buildPlainSummary } from '../pr-feedback/summary-comment';

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,5 @@ export function main() {
 a
+b
+c
 d
diff --git a/src/new.py b/src/new.py
new file mode 100644
--- /dev/null
+++ b/src/new.py
@@ -0,0 +1,2 @@
+x = 1
+y = 2
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/lib/a.js b/lib/b.js
similarity index 90%
rename from lib/a.js
rename to lib/b.js
--- a/lib/a.js
+++ b/lib/b.js
@@ -1,1 +1,1 @@
-old
+new
`;

describe('parseUnifiedDiff', () => {
  it('splits a whole-PR diff into files with their new-version line ranges', () => {
    expect(parseUnifiedDiff(DIFF)).toEqual([
      { path: 'src/app.ts', status: 'modified', ranges: [{ start: 10, end: 14 }] },
      { path: 'src/new.py', status: 'added', ranges: [{ start: 1, end: 2 }] },
      { path: 'old.txt', status: 'removed', ranges: [] },
      { path: 'lib/b.js', status: 'renamed', ranges: [{ start: 1, end: 1 }] },
    ]);
  });
});

describe('BitbucketService.verifyWebhookSignature', () => {
  const sign = (body: string, secret: string) =>
    `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  it('accepts the right secret only', () => {
    expect(BitbucketService.verifyWebhookSignature('s', Buffer.from('{}'), sign('{}', 's'))).toBe(true);
    expect(BitbucketService.verifyWebhookSignature('s', Buffer.from('{}'), sign('{}', 'other'))).toBe(false);
    expect(BitbucketService.verifyWebhookSignature('s', Buffer.from('{}'), undefined)).toBe(false);
  });
});

describe('BitbucketService.publish', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const context = {
    kind: 'bitbucket' as const,
    workspace: 'acme',
    repoSlug: 'api',
    pullId: 5,
    headSha: 'a'.repeat(40),
    sourceBranch: 'feature',
    destinationBranch: 'main',
  };
  const feedback = {
    verdict: 'do_not_ship' as const,
    summary: 'Reviewed 1/1 files.',
    changedRanges: { 'src/app.ts': [{ start: 10, end: 14 }] },
    findings: [
      {
        path: 'src/app.ts',
        line: 11,
        endLine: 12,
        severity: 'critical',
        title: 'Bad',
        description: 'd',
        category: 'Security',
      },
      { path: 'src/app.ts', line: 90, severity: 'low', title: 'Outside the diff', description: 'd' },
    ],
  };
  const service = () =>
    new BitbucketService(
      { user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ bitbucketToken: 'enc' }) } } as never,
      { register: jest.fn() } as never,
      { decrypt: () => 'tok' } as never,
    );

  it('posts plain inline comments inside the diff, a summary, and a failing build status', async () => {
    const calls: Array<{ url: string; body: any; auth: string }> = [];
    global.fetch = jest.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization ?? '' });
      return { ok: true, status: 201 };
    }) as never;

    await service().publish('u1', context, feedback);

    const comments = calls.filter((c) => c.url.endsWith('/pullrequests/5/comments'));
    expect(comments).toHaveLength(2);
    expect(comments[0].body.inline).toEqual({ path: 'src/app.ts', to: 11 });
    expect(comments[0].body.content.raw).not.toContain('<');
    expect(comments[1].body.content.raw).toContain('**Actionable comments posted: 1**');
    expect(calls.every((c) => c.auth === 'Bearer tok')).toBe(true);
    const status = calls.find((c) => c.url.includes(`/commit/${'a'.repeat(40)}/statuses/build`))!;
    expect(status.body).toMatchObject({ key: 'audit-bench', state: 'FAILED' });
  });

  it('throws an explained error when Bitbucket refuses the summary', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403 })) as never;
    await expect(service().publish('u1', context, feedback)).rejects.toThrow(/read:pullrequest:bitbucket/);
  });
});

describe('buildPlainSummary', () => {
  it('has no HTML, so Bitbucket renders it cleanly', () => {
    const body = buildPlainSummary(
      {
        verdict: 'needs_work',
        summary: 's',
        findings: [{ path: 'a.ts', line: 1, severity: 'medium', title: 't', description: 'd' }],
        scanUrl: 'https://x',
      },
      { posted: 1, headSha: 'abcdef123' },
    );
    expect(body).not.toMatch(/<\/?[a-z!]/i);
    expect(body).toContain('**Actionable comments posted: 1**');
    expect(body).toContain('[Open the full report and fix with AI](https://x)');
  });
});
