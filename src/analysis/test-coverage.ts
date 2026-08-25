import { ScannedFile } from './types';

export interface TestCoverageEstimate {
  sourceFileCount: number;
  testFileCount: number;
  /** testFileCount / sourceFileCount, rounded to 3dp — a file-count ratio, not a real line/branch coverage percentage. */
  testFileRatio: number;
  hasCoverageConfig: boolean;
  hasCiTestStep: boolean;
  riskLevel: 'high' | 'medium' | 'low';
  reason: string;
  /** Top-level directories that contain source files but no test file anywhere inside them. */
  untestedDirectories: string[];
}

// Deliberately narrower than analysis/language.ts's ANALYZABLE_EXTENSIONS
// (which also covers yaml/json/sql/prisma for LLM review) — config and data
// files are never expected to have their own unit tests, so including them
// here would dilute the source-file denominator and understate risk.
const CODE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'java', 'kt', 'php', 'cs', 'rs']);

const TEST_PATH_PATTERN =
  /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.py$|_test\.go$|_spec\.rb$/i;

const COVERAGE_CONFIG_BASENAMES = new Set([
  '.nycrc',
  '.nycrc.json',
  '.coveragerc',
  'codecov.yml',
  '.codecov.yml',
  'jest.config.js',
  'jest.config.ts',
  'jest.config.mjs',
  'jest.config.json',
  'vitest.config.js',
  'vitest.config.ts',
]);

const CI_CONFIG_PATH_PATTERN = /^\.github\/workflows\/.*\.ya?ml$|^\.gitlab-ci\.ya?ml$/;
const CI_TEST_KEYWORD_PATTERN = /\b(test|jest|pytest|vitest|mocha|coverage)\b/i;

function isCodeFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return Boolean(ext && CODE_EXTENSIONS.has(ext));
}

function isTestFile(path: string): boolean {
  return TEST_PATH_PATTERN.test(path);
}

function hasCoverageConfig(files: ScannedFile[]): boolean {
  return files.some((f) => {
    const basename = f.path.split('/').pop() || '';
    if (COVERAGE_CONFIG_BASENAMES.has(basename)) return true;
    if (basename === 'package.json') return /"coverageThreshold"|"nyc"\s*:/.test(f.content);
    if (basename === 'pyproject.toml' || basename === 'setup.cfg' || basename === 'pytest.ini') {
      return /\[coverage|--cov\b|pytest-cov/.test(f.content);
    }
    return false;
  });
}

function hasCiTestStep(files: ScannedFile[]): boolean {
  return files.some((f) => CI_CONFIG_PATH_PATTERN.test(f.path) && CI_TEST_KEYWORD_PATTERN.test(f.content));
}

/** First path segment, or "." for a file at the repo root. */
function topLevelDir(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? '.' : path.slice(0, slash);
}

/**
 * A static, no-execution approximation of test coverage: the ratio of test
 * files to source files, plus whether a coverage tool/threshold and a CI
 * test step are configured. Deliberately does NOT run the target's actual
 * test suite (`jest --coverage` / `pytest-cov`) — that would mean executing
 * an unvetted third-party (often an M&A target's) codebase on this
 * infrastructure, which nothing else in this scanner does. Less precise
 * than a real coverage run; safe against any repository this points at.
 */
export function estimateTestCoverage(files: ScannedFile[]): TestCoverageEstimate {
  const codeFiles = files.filter((f) => isCodeFile(f.path));
  const testFiles = codeFiles.filter((f) => isTestFile(f.path));
  const sourceFiles = codeFiles.filter((f) => !isTestFile(f.path));

  const sourceFileCount = sourceFiles.length;
  const testFileCount = testFiles.length;
  const testFileRatio =
    sourceFileCount > 0 ? testFileCount / sourceFileCount : testFileCount > 0 ? 1 : 0;

  const configPresent = hasCoverageConfig(files);
  const ciPresent = hasCiTestStep(files);

  const dirHasTest = new Map<string, boolean>();
  for (const f of sourceFiles) {
    const dir = topLevelDir(f.path);
    if (!dirHasTest.has(dir)) dirHasTest.set(dir, false);
  }
  for (const f of testFiles) {
    const dir = topLevelDir(f.path);
    if (dirHasTest.has(dir)) dirHasTest.set(dir, true);
  }
  const untestedDirectories = [...dirHasTest.entries()]
    .filter(([, hasTest]) => !hasTest)
    .map(([dir]) => dir)
    .sort()
    .slice(0, 10);

  let riskLevel: 'high' | 'medium' | 'low';
  let reason: string;
  if (sourceFileCount === 0) {
    riskLevel = 'low';
    reason = 'No analyzable source files found to assess.';
  } else if (testFileCount === 0) {
    riskLevel = 'high';
    reason = 'No test files detected anywhere in this codebase.';
  } else if (testFileRatio < 0.2) {
    riskLevel = 'high';
    reason = `Only ${testFileCount} test file(s) found for ${sourceFileCount} source file(s) — a thin test-file-to-source ratio.`;
  } else if (testFileRatio < 0.5) {
    riskLevel = 'medium';
    reason = `${testFileCount} test file(s) for ${sourceFileCount} source file(s) — a moderate test-file-to-source ratio.`;
  } else {
    riskLevel = 'low';
    reason = `${testFileCount} test file(s) for ${sourceFileCount} source file(s) — a healthy test-file-to-source ratio.`;
  }

  // A raw file-count ratio can understate real coverage when fewer, broader
  // integration/e2e tests are enforced by a tracked coverage threshold in
  // CI — soften the read by one level rather than let a heuristic blind to
  // that context overstate the risk.
  if (configPresent && ciPresent) {
    if (riskLevel === 'high') {
      riskLevel = 'medium';
      reason += ' Softened one level: a coverage threshold and a CI test step were both found, which the file-ratio alone would miss.';
    } else if (riskLevel === 'medium') {
      riskLevel = 'low';
      reason += ' Softened one level: a coverage threshold and a CI test step were both found.';
    }
  }

  return {
    sourceFileCount,
    testFileCount,
    testFileRatio: Math.round(testFileRatio * 1000) / 1000,
    hasCoverageConfig: configPresent,
    hasCiTestStep: ciPresent,
    riskLevel,
    reason,
    untestedDirectories,
  };
}
