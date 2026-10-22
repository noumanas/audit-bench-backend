import { buildCheckRun, checkConclusion, CHECK_NAME } from './check-run';

const base = { summary: 's', scanUrl: 'https://auditbenchai.com/app/repository/1' };

describe('check run verdict', () => {
  it('fails only on blocking issues, and is neutral (still mergeable) for issues worth a look', () => {
    expect(checkConclusion({ ...base, verdict: 'do_not_ship', findings: [] })).toBe('failure');
    expect(checkConclusion({ ...base, verdict: 'needs_work', findings: [] })).toBe('neutral');
    expect(checkConclusion({ ...base, verdict: 'pass', findings: [] })).toBe('success');
  });

  it('builds the check with a stable name and one annotation per finding', () => {
    const run = buildCheckRun(
      {
        ...base,
        verdict: 'do_not_ship',
        findings: [
          {
            path: 'src/a.ts',
            line: 10,
            endLine: 12,
            severity: 'critical',
            title: 'SQL injection',
            description: 'd',
            suggestedFix: 'Use parameters.',
          },
          { path: 'src/b.ts', line: null, severity: 'low', title: 'No line', description: 'd' },
          { path: 'src/c.ts', line: 4, severity: 'medium', title: 'Slow loop', description: 'd' },
        ],
      },
      'abc123',
    );
    expect(run).toMatchObject({
      name: CHECK_NAME,
      head_sha: 'abc123',
      status: 'completed',
      conclusion: 'failure',
      details_url: base.scanUrl,
    });
    expect(run.output.title).toBe('Blocking issues found');
    expect(run.output.annotations).toEqual([
      {
        path: 'src/a.ts',
        start_line: 10,
        end_line: 12,
        annotation_level: 'failure',
        title: 'SQL injection',
        message: 'd\n\nSuggested fix: Use parameters.',
      },
      { path: 'src/c.ts', start_line: 4, end_line: 4, annotation_level: 'warning', title: 'Slow loop', message: 'd' },
    ]);
  });
});

describe('merge gate', () => {
  it('fails the check whenever the PR is not ready to merge, listing why', () => {
    const run = buildCheckRun(
      { ...base, verdict: 'needs_work', findings: [], readiness: { status: 'not_ready', blockers: ['1 high-severity security issue in the changed lines.'], notes: [] } },
      'sha',
    );
    expect(run.conclusion).toBe('failure');
    expect(run.output.summary).toContain('- 1 high-severity security issue in the changed lines.');
  });
});
