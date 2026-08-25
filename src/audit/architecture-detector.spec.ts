import { buildArchitecturePrompt, architectureAssessmentSchema } from './architecture-detector';
import { ScannedFile } from '../analysis/types';

function file(path: string, content = 'export const x = 1;'): ScannedFile {
  return { path, content };
}

describe('buildArchitecturePrompt', () => {
  it('returns null when there are too few files to compare', () => {
    expect(buildArchitecturePrompt([file('a.ts'), file('b.ts')])).toBeNull();
  });

  it('builds a prompt including every sampled file path', () => {
    const files = [file('src/a.ts'), file('src/b.ts'), file('lib/c.ts')];
    const prompt = buildArchitecturePrompt(files);
    expect(prompt).not.toBeNull();
    for (const f of files) expect(prompt).toContain(f.path);
  });

  it('prioritizes core source directories over everything else when sampling', () => {
    const files = [file('scripts/one-off.ts'), file('src/core.ts'), file('src/other.ts'), file('README.md')];
    const prompt = buildArchitecturePrompt(files)!;
    const coreIndex = prompt.indexOf('src/core.ts');
    const scriptIndex = prompt.indexOf('scripts/one-off.ts');
    expect(coreIndex).toBeGreaterThan(-1);
    expect(coreIndex).toBeLessThan(scriptIndex);
  });

  it('truncates very large files and marks them as truncated', () => {
    const big = file('src/big.ts', 'x'.repeat(5000));
    const prompt = buildArchitecturePrompt([big, file('src/a.ts'), file('src/b.ts')])!;
    expect(prompt).toContain('... (truncated)');
    // The full 5000-char body should not appear verbatim.
    expect(prompt).not.toContain('x'.repeat(5000));
  });

  it('caps the number of sampled files and reports the true total', () => {
    const many = Array.from({ length: 30 }, (_, i) => file(`src/f${i}.ts`));
    const prompt = buildArchitecturePrompt(many)!;
    expect(prompt).toContain('30 total');
    expect(prompt).toContain('15 representative');
  });
});

describe('architectureAssessmentSchema', () => {
  it('accepts a well-formed assessment', () => {
    const parsed = architectureAssessmentSchema.parse({
      consistencyScore: 72,
      riskLevel: 'medium',
      summary: 'Mostly consistent, with one legacy module.',
      inconsistencies: [{ title: 'Mixed state management', description: 'Redux in one module, plain hooks elsewhere.', files: ['src/a.ts'] }],
    });
    expect(parsed.consistencyScore).toBe(72);
  });

  it('rejects an out-of-range consistency score', () => {
    expect(() =>
      architectureAssessmentSchema.parse({ consistencyScore: 150, riskLevel: 'low', summary: 'x', inconsistencies: [] }),
    ).toThrow();
  });
});
