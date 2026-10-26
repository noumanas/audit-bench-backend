import { repoApiPath } from './github-url';

describe('repoApiPath', () => {
  it('passes real GitHub names through', () => {
    expect(repoApiPath('Netflix', 'metaflow')).toBe('Netflix/metaflow');
    expect(repoApiPath('my-org', 'repo.name_v2')).toBe('my-org/repo.name_v2');
  });

  it('refuses anything that could change the API path', () => {
    for (const [owner, repo] of [
      ['..', 'x'],
      ['.', 'x'],
      ['acme', '..'],
      ['acme/../users', 'x'],
      ['acme', 'api?admin=1'],
      ['acme', 'a b'],
      ['acme', 'a%2F..'],
      ['', 'x'],
    ]) {
      expect(() => repoApiPath(owner, repo)).toThrow(/isn't a valid GitHub repository/);
    }
  });
});
