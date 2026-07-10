import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GithubPrDetails, GithubPrFile, GithubRepoSummary } from './github.types';
import { parseChangedRanges } from '../common/diff-ranges';

const GITHUB_API = 'https://api.github.com';

@Injectable()
export class GithubService {
  constructor(private readonly prisma: PrismaService) {}

  private authHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-code-auditor',
    };
  }

  private async requireToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.githubToken) {
      throw new BadRequestException('Connect a GitHub account first');
    }
    return user.githubToken;
  }

  async connect(userId: string, token: string) {
    const res = await fetch(`${GITHUB_API}/user`, { headers: this.authHeaders(token) });
    if (!res.ok) {
      throw new BadRequestException(
        res.status === 401
          ? 'That GitHub token was rejected — check it has "repo" scope and hasn\'t expired'
          : `GitHub rejected the request (${res.status})`,
      );
    }
    const profile = await res.json();

    await this.prisma.user.update({
      where: { id: userId },
      data: { githubToken: token, githubUsername: profile.login },
    });

    return { username: profile.login as string };
  }

  async disconnect(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { githubToken: null, githubUsername: null },
    });
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { connected: Boolean(user.githubToken), username: user.githubUsername };
  }

  async listRepos(userId: string): Promise<GithubRepoSummary[]> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${GITHUB_API}/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member`, {
      headers: this.authHeaders(token),
    });
    if (!res.ok) {
      throw new BadRequestException(`GitHub rejected the request (${res.status}) — token may be invalid or expired`);
    }

    const repos = await res.json();
    return repos.map(
      (r: any): GithubRepoSummary => ({
        id: r.id,
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        description: r.description,
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
        htmlUrl: r.html_url,
      }),
    );
  }

  async listBranches(userId: string, owner: string, repo: string): Promise<string[]> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/branches?per_page=100`, {
      headers: this.authHeaders(token),
    });
    if (res.status === 404) {
      throw new NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
    }
    if (!res.ok) {
      throw new BadRequestException(`GitHub rejected the request (${res.status})`);
    }

    const branches: any[] = await res.json();
    return branches.map((b) => b.name as string);
  }

  async downloadRepoZip(userId: string, owner: string, repo: string, ref?: string): Promise<Buffer> {
    const token = await this.requireToken(userId);

    const path = ref ? `${owner}/${repo}/zipball/${ref}` : `${owner}/${repo}/zipball`;
    const res = await fetch(`${GITHUB_API}/repos/${path}`, { headers: this.authHeaders(token) });

    if (res.status === 404) {
      throw new NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
    }
    if (!res.ok) {
      throw new BadRequestException(`GitHub rejected the download (${res.status})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Fetches a PR's changed files plus their full content at the PR's head
   * commit, and the line ranges each file's diff actually touched — so a
   * PR review can scope itself to the diff instead of re-reading whole
   * files. Removed files and files GitHub didn't include a patch for
   * (binary, or too large) are skipped — nothing to review there.
   */
  async fetchPrFiles(userId: string, owner: string, repo: string, pullNumber: number): Promise<GithubPrDetails> {
    const token = await this.requireToken(userId);

    const prRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}`, {
      headers: this.authHeaders(token),
    });
    if (prRes.status === 404) {
      throw new NotFoundException(`PR #${pullNumber} not found in ${owner}/${repo}, or not accessible with this token`);
    }
    if (!prRes.ok) throw new BadRequestException(`GitHub rejected the request (${prRes.status})`);
    const pr = await prRes.json();
    const headSha: string = pr.head.sha;

    const filesRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`, {
      headers: this.authHeaders(token),
    });
    if (!filesRes.ok) throw new BadRequestException(`GitHub rejected the request (${filesRes.status})`);
    const rawFiles: any[] = await filesRes.json();

    const files: GithubPrFile[] = [];
    for (const f of rawFiles) {
      if (f.status === 'removed' || !f.patch) continue;
      const content = await this.fetchFileContent(token, owner, repo, f.filename, headSha);
      if (content === null) continue;
      files.push({
        path: f.filename,
        content,
        changedRanges: parseChangedRanges(f.patch),
        status: f.status,
      });
    }

    return { files, headSha, url: pr.html_url };
  }

  private async fetchFileContent(token: string, owner: string, repo: string, path: string, ref: string): Promise<string | null> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${ref}`, {
      headers: this.authHeaders(token),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.encoding !== 'base64' || typeof data.content !== 'string') return null;
    return Buffer.from(data.content, 'base64').toString('utf8');
  }
}
