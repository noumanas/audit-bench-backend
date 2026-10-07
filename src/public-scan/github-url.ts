export interface ParsedGithubRepo {
  owner: string;
  repo: string;
  /** Branch from a /tree/<branch> URL, if the user pasted one. */
  ref?: string;
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * Accepts what people actually paste: a full URL (with or without
 * https://, www., .git or a /tree/<branch> suffix) or a bare "owner/repo".
 * Returns null for anything that isn't clearly a GitHub repository.
 */
export function parseGithubRepoUrl(input: string): ParsedGithubRepo | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (/^github\.com\//i.test(s)) s = s.slice('github.com/'.length);
  else if (s.includes('.') && s.split('/')[0].includes('.')) return null; // some other host
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');

  const parts = s.split('/');
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!NAME.test(owner) || !NAME.test(repo) || /^\.+$/.test(owner) || /^\.+$/.test(repo)) return null;

  let ref: string | undefined;
  if (parts[2] === 'tree' && parts.length > 3) ref = decodeURIComponent(parts.slice(3).join('/'));
  return { owner, repo, ref };
}
