import { estimateTestCoverage } from './test-coverage';
import { ScannedFile } from './types';

function file(path: string, content = 'x'): ScannedFile {
  return { path, content };
}

describe('estimateTestCoverage', () => {
  it('flags high risk when there are source files but no tests at all', () => {
    const result = estimateTestCoverage([file('src/index.ts'), file('src/utils.ts')]);
    expect(result.sourceFileCount).toBe(2);
    expect(result.testFileCount).toBe(0);
    expect(result.riskLevel).toBe('high');
    expect(result.reason).toMatch(/no test files detected/i);
  });

  it('recognizes JS/TS test naming conventions (.test., .spec., __tests__/)', () => {
    const result = estimateTestCoverage([
      file('src/a.ts'),
      file('src/b.ts'),
      file('src/a.test.ts'),
      file('src/__tests__/b.spec.tsx'),
    ]);
    expect(result.sourceFileCount).toBe(2);
    expect(result.testFileCount).toBe(2);
  });

  it('recognizes Python test naming conventions (test_*.py, *_test.py, tests/)', () => {
    const result = estimateTestCoverage([
      file('app/models.py'),
      file('app/test_models.py'),
      file('app/views_test.py'),
      file('tests/test_extra.py'),
    ]);
    expect(result.testFileCount).toBe(3);
    expect(result.sourceFileCount).toBe(1);
  });

  it('recognizes Go and Ruby test conventions', () => {
    const result = estimateTestCoverage([file('main.go'), file('main_test.go'), file('app.rb'), file('app_spec.rb')]);
    expect(result.testFileCount).toBe(2);
    expect(result.sourceFileCount).toBe(2);
  });

  it('ignores non-code files (yaml/json/sql) when counting source files', () => {
    const result = estimateTestCoverage([file('src/index.ts'), file('config.yaml'), file('schema.sql'), file('package.json')]);
    expect(result.sourceFileCount).toBe(1);
  });

  it('reports low risk for a healthy test-file ratio', () => {
    const result = estimateTestCoverage([
      file('src/a.ts'),
      file('src/a.test.ts'),
      file('src/b.ts'),
      file('src/b.test.ts'),
    ]);
    expect(result.testFileRatio).toBe(1);
    expect(result.riskLevel).toBe('low');
  });

  it('reports medium risk for a moderate ratio and high risk for a thin one', () => {
    // 1 test file for 3 source files ≈ 0.33 → medium
    const moderate = estimateTestCoverage([file('a.ts'), file('b.ts'), file('c.ts'), file('a.test.ts')]);
    expect(moderate.riskLevel).toBe('medium');

    // 1 test file for 10 source files = 0.1 → high
    const thin = estimateTestCoverage([
      ...Array.from({ length: 10 }, (_, i) => file(`src/f${i}.ts`)),
      file('src/f0.test.ts'),
    ]);
    expect(thin.riskLevel).toBe('high');
  });

  it('softens the risk level by one when both a coverage config and a CI test step are present', () => {
    const withoutSignals = estimateTestCoverage([
      ...Array.from({ length: 10 }, (_, i) => file(`src/f${i}.ts`)),
      file('src/f0.test.ts'),
    ]);
    expect(withoutSignals.riskLevel).toBe('high');

    const withSignals = estimateTestCoverage([
      ...Array.from({ length: 10 }, (_, i) => file(`src/f${i}.ts`)),
      file('src/f0.test.ts'),
      file('jest.config.js', 'module.exports = { coverageThreshold: { global: { lines: 80 } } }'),
      file('.github/workflows/ci.yml', 'run: npm test -- --coverage'),
    ]);
    expect(withSignals.riskLevel).toBe('medium');
    expect(withSignals.hasCoverageConfig).toBe(true);
    expect(withSignals.hasCiTestStep).toBe(true);
    expect(withSignals.reason).toMatch(/softened/i);
  });

  it('detects a coverage config declared inside package.json', () => {
    const result = estimateTestCoverage([
      file('src/a.ts'),
      file('src/a.test.ts'),
      file('package.json', '{"jest": {"coverageThreshold": {"global": {"lines": 80}}}}'),
    ]);
    expect(result.hasCoverageConfig).toBe(true);
  });

  it('lists top-level directories that have source files but no tests', () => {
    const result = estimateTestCoverage([
      file('billing/invoice.ts'),
      file('billing/refund.ts'),
      file('auth/login.ts'),
      file('auth/login.test.ts'),
    ]);
    expect(result.untestedDirectories).toEqual(['billing']);
  });

  it('reports low risk (not high) when there are no source files to assess at all', () => {
    const result = estimateTestCoverage([file('README.md'), file('config.yaml')]);
    expect(result.sourceFileCount).toBe(0);
    expect(result.riskLevel).toBe('low');
    expect(result.reason).toMatch(/no analyzable source files/i);
  });
});
