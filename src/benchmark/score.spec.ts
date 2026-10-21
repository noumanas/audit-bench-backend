import { lineOf, scoreCase, summarize, BenchmarkCase } from './score';
import { BENCHMARK_CASES } from '../../benchmark/cases';

const bugCase: BenchmarkCase = {
  id: 'sql',
  title: 'SQL built from input',
  path: 'a.ts',
  code: 'line1\nconst q = "SELECT * FROM t WHERE id=" + id;\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10',
  changed: [{ start: 1, end: 10 }],
  bugs: [{ at: 'SELECT * FROM t', what: 'SQL injection' }],
};

describe('benchmark scoring', () => {
  it('finds a bug line by its text', () => {
    expect(lineOf(bugCase.code, 'SELECT * FROM t')).toBe(2);
    expect(() => lineOf(bugCase.code, 'nope')).toThrow(/broken/);
  });

  it('counts a medium-or-worse finding near the bug as a catch, and others as false positives', () => {
    const r = scoreCase(bugCase, [
      { line: 4, severity: 'high', title: 'injection' },
      { line: 10, severity: 'medium', title: 'unrelated' },
      { line: 2, severity: 'low', title: 'style' },
    ]);
    expect(r.caught).toEqual(['SQL injection']);
    expect(r.missed).toEqual([]);
    expect(r.falsePositives.map((f) => f.title)).toEqual(['unrelated']);
  });

  it('misses a bug when only low-severity or far-away findings exist', () => {
    const r = scoreCase(bugCase, [
      { line: 2, severity: 'low', title: 'style' },
      { line: 9, severity: 'high', title: 'far' },
    ]);
    expect(r.missed).toEqual(['SQL injection']);
  });

  it('summarises catch rate and false alarms on clean changes', () => {
    const clean = { ...bugCase, id: 'clean', bugs: [] };
    const s = summarize([
      scoreCase(bugCase, [{ line: 2, severity: 'critical', title: 'x' }]),
      scoreCase(clean, [{ line: 5, severity: 'medium', title: 'noise' }]),
      scoreCase({ ...clean, id: 'clean2' }, []),
    ]);
    expect(s).toMatchObject({ bugs: 1, caught: 1, catchRate: 1, cleanCases: 2, flaggedClean: 1, cleanFalseAlarmRate: 0.5 });
  });

  it('every shipped case is well formed', () => {
    expect(BENCHMARK_CASES.length).toBeGreaterThanOrEqual(12);
    for (const c of BENCHMARK_CASES) {
      const lines = c.code.split('\n').length;
      for (const r of c.changed) expect(r.start >= 1 && r.end <= lines && r.start <= r.end).toBe(true);
      for (const b of c.bugs) {
        const line = lineOf(c.code, b.at);
        // A seeded bug must sit inside the changed lines, or the review is told to ignore it.
        expect(c.changed.some((r) => line >= r.start && line <= r.end)).toBe(true);
      }
      expect(c.code).not.toMatch(/\bBUG\b|FIXME|seeded/i);
    }
  });
});
