/**
 * The OAuth authorize/token endpoints live at the GitLab instance root, but
 * this app's existing GITLAB_BASE_URL config point at .../api/v4 — this
 * derives the root consistently wherever it's needed (initial OAuth
 * exchange, and later token refresh) so both always hit the same host.
 */
export function gitlabInstanceUrl(getEnv: (key: string) => string | undefined): string {
  const explicit = getEnv('GITLAB_INSTANCE_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  const apiBase = getEnv('GITLAB_BASE_URL');
  if (apiBase) return apiBase.replace(/\/api\/v4\/?$/, '');
  return 'https://gitlab.com';
}
