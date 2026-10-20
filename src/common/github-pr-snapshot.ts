import { PrSnapshot } from './merge-readiness';

const GITHUB_API = 'https://api.github.com';

/** The parts of GitHub's pull request payload a review reads. */
export interface GithubPull {
  title: string;
  body?: string | null;
  html_url: string;
  state: 'open' | 'closed';
  merged?: boolean;
  draft?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string; private: boolean; size?: number } };
}

/**
 * GitHub works out mergeability in the background after the first request
 * for an open PR, so `mergeable` comes back null once; ask again shortly after.
 */
export async function refetchIfMergeabilityPending(
  pr: GithubPull,
  headers: Record<string, string>,
  owner: string,
  repo: string,
  number: number,
): Promise<GithubPull> {
  if (pr.state !== 'open' || pr.mergeable !== null) return pr;
  await new Promise((r) => setTimeout(r, 1500));
  const again = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}`, { headers });
  return again.ok ? ((await again.json()) as GithubPull) : pr;
}

/** CI results for a commit: GitHub Actions/app check runs plus legacy commit statuses. */
export async function fetchCiChecks(
  headers: Record<string, string>,
  owner: string,
  repo: string,
  sha: string,
): Promise<PrSnapshot['checks']> {
  const checks: PrSnapshot['checks'] = { passed: 0, failed: [], pending: [] };
  const [runsRes, statusRes] = await Promise.all([
    fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, { headers }),
    fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}/status`, { headers }),
  ]);
  if (runsRes.ok) {
    const body = (await runsRes.json()) as { check_runs?: Array<{ name: string; status: string; conclusion: string | null }> };
    for (const run of body.check_runs ?? []) {
      if (run.status !== 'completed') checks.pending.push(run.name);
      else if (['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(run.conclusion ?? '')) {
        checks.failed.push(run.name);
      } else checks.passed++;
    }
  }
  if (statusRes.ok) {
    const body = (await statusRes.json()) as { statuses?: Array<{ context: string; state: string }> };
    for (const st of body.statuses ?? []) {
      if (st.state === 'pending') checks.pending.push(st.context);
      else if (st.state === 'failure' || st.state === 'error') checks.failed.push(st.context);
      else checks.passed++;
    }
  }
  return checks;
}

export function toPrSnapshot(
  pr: GithubPull,
  owner: string,
  repo: string,
  number: number,
  checks: PrSnapshot['checks'],
  filesReviewed: number,
  changedFilesListed: number,
): PrSnapshot {
  const changedFiles = pr.changed_files ?? changedFilesListed;
  return {
    owner,
    repo,
    number,
    title: pr.title,
    body: (pr.body ?? '').slice(0, 4000),
    url: pr.html_url,
    state: pr.state,
    merged: Boolean(pr.merged),
    draft: Boolean(pr.draft),
    mergeable: pr.mergeable ?? null,
    mergeableState: pr.mergeable_state ?? 'unknown',
    baseRef: pr.base.ref,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles,
    commits: pr.commits ?? 0,
    checks,
    filesReviewed,
    filesSkipped: Math.max(changedFiles - filesReviewed, 0),
    fetchedAt: new Date().toISOString(),
  };
}
