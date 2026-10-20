import { commentLines, inlineCommentBody, parseFindingComment } from './inline-comment';

const finding = {
  path: 'tests/mcp-live-smoke.test.mjs',
  line: 233,
  endLine: 235,
  severity: 'medium',
  title: 'Auth-link failures lack tests',
  description: 'The new smoke check has no tests for the failures it is meant to catch.',
  category: 'Testing',
  rootCause: 'The fixture only returns the happy path.',
  suggestedFix: 'Add cases where /auth.md redirects and assert the run fails.',
  examplePatch: "if (req.url === '/auth.md') {\n  res.writeHead(302, { Location: '/elsewhere' }).end();\n}",
  confidence: 0.82,
};

describe('commentLines', () => {
  it('covers the finding range when it sits inside one hunk', () => {
    expect(commentLines(finding, [{ start: 220, end: 260 }])).toEqual({ start: 233, end: 235 });
  });

  it('clips the range to the hunk holding the first line', () => {
    expect(commentLines(finding, [{ start: 230, end: 234 }])).toEqual({ start: 233, end: 234 });
  });

  it('skips findings outside the diff, or without a line', () => {
    expect(commentLines(finding, [{ start: 1, end: 10 }])).toBeNull();
    expect(commentLines({ ...finding, line: null }, [{ start: 1, end: 300 }])).toBeNull();
  });

  it('falls back to a single line for no end line, or one far too long', () => {
    expect(commentLines({ ...finding, endLine: null })).toEqual({ start: 233, end: 233 });
    expect(commentLines({ ...finding, endLine: 900 })).toEqual({ start: 233, end: 233 });
  });
});

describe('inlineCommentBody', () => {
  it('reads like a reviewer: category and severity, headline, what, why, fix, example and reply hint', () => {
    const body = inlineCommentBody(finding);
    expect(body.split('\n').slice(0, 4)).toEqual([
      '<!-- audit-bench:finding -->',
      '**🧪 Testing | 🟡 Medium**',
      '',
      '**Auth-link failures lack tests**',
    ]);
    expect(body).toContain('**Why it happens:** The fixture only returns the happy path.');
    expect(body).toContain('**Suggested fix:** Add cases where /auth.md redirects');
    expect(body).toContain("```mjs\nif (req.url === '/auth.md') {");
    expect(body.trim().split('\n').pop()).toBe(
      '<sub>82% confidence · 💬 Reply here and Audit Bench Ai will recheck the code · 👍/👎 teaches it what your team wants</sub>',
    );
  });

  it('fences a patch that itself contains backticks', () => {
    const body = inlineCommentBody({ ...finding, examplePatch: 'const s = ```x```;' });
    expect(body).toContain('````mjs\nconst s = ```x```;\n````');
  });
});

describe('parseFindingComment', () => {
  it('reads the category and title back out of our own comment', () => {
    expect(parseFindingComment(inlineCommentBody(finding))).toEqual({ category: 'Testing', title: 'Auth-link failures lack tests' });
  });

  it('ignores comments that are not ours', () => {
    expect(parseFindingComment('**Looks good** to me')).toBeNull();
  });
});
