import { findingFingerprint, matchesGlob } from './finding-fingerprint';

describe('findingFingerprint', () => {
  it('treats the same kind of issue on different identifiers as one', () => {
    const a = findingFingerprint({ category: 'Security', title: 'The `userId` parameter is never checked' });
    const b = findingFingerprint({ category: 'Security', title: 'The `orgId` parameter is never checked!' });
    expect(a).toBe(b);
    expect(a).toBe('security:checked-never-parameter');
  });

  it('keeps different categories and different issues apart', () => {
    const t = 'Missing error handling around fetch';
    expect(findingFingerprint({ category: 'Logic', title: t })).not.toBe(findingFingerprint({ category: 'Performance', title: t }));
    expect(findingFingerprint({ category: 'Logic', title: t })).not.toBe(
      findingFingerprint({ category: 'Logic', title: 'Loop runs one time too many' }),
    );
  });
});

describe('matchesGlob', () => {
  it.each([
    ['src/generated/api.ts', 'src/generated/**', true],
    ['src/generated/deep/api.ts', 'src/generated/', true],
    ['src/api.generated.ts', '*.generated.ts', true],
    ['deep/dir/x.min.js', '*.min.js', true],
    ['scripts/seed.ts', 'scripts/*.ts', true],
    ['scripts/sub/seed.ts', 'scripts/*.ts', false],
    ['migrations/001.sql', '**/migrations/**', true],
    ['src/app.ts', 'src/generated/**', false],
    ['src/a.ts', '', false],
  ])('%s against %s → %s', (path, pattern, expected) => {
    expect(matchesGlob(path, pattern)).toBe(expected);
  });
});
