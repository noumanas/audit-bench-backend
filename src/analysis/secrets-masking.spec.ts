import { maskSecret, scanSecrets } from './secrets-scanner';

describe('secret masking', () => {
  it('keeps only the start and end of a found secret', () => {
    const [f] = scanSecrets([{ path: 'config.ts', content: 'const key = "AKIAABCDEFGHIJKLMN7Q";' }]);
    expect(f.rule).toBe('AWS Access Key');
    expect(f.snippet).toBe('const key = "AKIA…7Q";');
    expect(f.snippet).not.toContain('AKIAABCDEFGHIJKLMN7Q');
  });

  it('hides short secrets entirely', () => {
    expect(maskSecret('pw = "abc123"', 'abc123')).toBe('pw = "…"');
  });
});
