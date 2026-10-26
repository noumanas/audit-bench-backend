import { withoutConflictingReplacements } from './inline-comment';
import { softenWordingChecks } from './pr-insights';

describe('withoutConflictingReplacements', () => {
  it('drops one-click fixes whose lines overlap another finding in the same file', () => {
    const out = withoutConflictingReplacements([
      { path: 'a.cs', line: 10, endLine: 12, replacement: 'using (var c = ...)' },
      { path: 'a.cs', line: 11, endLine: null, replacement: 'cmd.Parameters.Add(...)' },
      { path: 'a.cs', line: 30, endLine: null, replacement: 'keep me' },
      { path: 'b.cs', line: 11, endLine: null, replacement: 'other file' },
    ]);
    expect(out.map((f) => f.replacement)).toEqual([null, null, 'keep me', 'other file']);
  });
});

describe('softenWordingChecks', () => {
  it('never lets the title or description checks fail a PR', () => {
    const out = softenWordingChecks({
      walkthrough: 'w',
      files: [],
      mergeRisk: { level: 'low', explanation: 'e' },
      checks: [
        { name: 'Title check', status: 'fail', explanation: 'says do not merge' },
        { name: 'Out of scope changes check', status: 'fail', explanation: 'x' },
      ],
    });
    expect(out.checks.map((c) => c.status)).toEqual(['warning', 'fail']);
  });
});
