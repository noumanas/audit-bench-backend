import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { GitlabMrDetails, GitlabMrFile, GitlabProjectSummary } from './gitlab.types';
import { parseChangedRanges } from '../common/diff-ranges';

@Injectable()
export class GitlabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private baseUrl(): string {
    return this.config.get<string>('GITLAB_BASE_URL') || 'https://gitlab.com/api/v4';
  }

  private authHeaders(token: string) {
    return { 'PRIVATE-TOKEN': token, 'User-Agent': 'ai-code-auditor' };
  }

  private async requireToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.gitlabToken) {
      throw new BadRequestException('Connect a GitLab account first');
    }
    return user.gitlabToken;
  }

  async connect(userId: string, token: string) {
    const res = await fetch(`${this.baseUrl()}/user`, { headers: this.authHeaders(token) });
    if (!res.ok) {
      throw new BadRequestException(
        res.status === 401
          ? 'That GitLab token was rejected — check it has "read_api" (or "api") scope and hasn\'t expired'
          : `GitLab rejected the request (${res.status})`,
      );
    }
    const profile = await res.json();

    await this.prisma.user.update({
      where: { id: userId },
      data: { gitlabToken: token, gitlabUsername: profile.username },
    });

    return { username: profile.username as string };
  }

  async disconnect(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { gitlabToken: null, gitlabUsername: null },
    });
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { connected: Boolean(user.gitlabToken), username: user.gitlabUsername };
  }

  async listProjects(userId: string): Promise<GitlabProjectSummary[]> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${this.baseUrl()}/projects?membership=true&per_page=100&order_by=last_activity_at&sort=desc`, {
      headers: this.authHeaders(token),
    });
    if (!res.ok) {
      throw new BadRequestException(`GitLab rejected the request (${res.status}) — token may be invalid or expired`);
    }

    const projects = await res.json();
    return projects.map(
      (p: any): GitlabProjectSummary => ({
        id: p.id,
        pathWithNamespace: p.path_with_namespace,
        name: p.name,
        private: p.visibility !== 'public',
        description: p.description,
        defaultBranch: p.default_branch,
        updatedAt: p.last_activity_at,
        webUrl: p.web_url,
      }),
    );
  }

  async listBranches(userId: string, projectId: number): Promise<string[]> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${this.baseUrl()}/projects/${projectId}/repository/branches?per_page=100`, {
      headers: this.authHeaders(token),
    });
    if (res.status === 404) {
      throw new NotFoundException(`Project ${projectId} not found or not accessible with this token`);
    }
    if (!res.ok) {
      throw new BadRequestException(`GitLab rejected the request (${res.status})`);
    }

    const branches: any[] = await res.json();
    return branches.map((b) => b.name as string);
  }

  async downloadProjectZip(userId: string, projectId: number, ref?: string): Promise<Buffer> {
    const token = await this.requireToken(userId);

    const query = ref ? `?sha=${encodeURIComponent(ref)}` : '';
    const res = await fetch(`${this.baseUrl()}/projects/${projectId}/repository/archive.zip${query}`, {
      headers: this.authHeaders(token),
    });

    if (res.status === 404) {
      throw new NotFoundException(`Project ${projectId} not found or not accessible with this token`);
    }
    if (!res.ok) {
      throw new BadRequestException(`GitLab rejected the download (${res.status})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Fetches an MR's changed files plus their full content at the MR's head
   * commit, and the line ranges each file's diff actually touched — same
   * diff-scoping idea as GithubService.fetchPrFiles.
   */
  async fetchMrFiles(userId: string, projectId: number, mrIid: number): Promise<GitlabMrDetails> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${this.baseUrl()}/projects/${projectId}/merge_requests/${mrIid}/changes`, {
      headers: this.authHeaders(token),
    });
    if (res.status === 404) {
      throw new NotFoundException(`MR !${mrIid} not found in project ${projectId}, or not accessible with this token`);
    }
    if (!res.ok) throw new BadRequestException(`GitLab rejected the request (${res.status})`);
    const mr = await res.json();
    const headSha: string = mr.diff_refs?.head_sha;

    const files: GitlabMrFile[] = [];
    for (const c of mr.changes || []) {
      if (c.deleted_file || !c.diff) continue;
      const content = await this.fetchFileContent(token, projectId, c.new_path, headSha);
      if (content === null) continue;
      files.push({
        path: c.new_path,
        content,
        changedRanges: parseChangedRanges(c.diff),
        status: c.new_file ? 'added' : c.renamed_file ? 'renamed' : 'modified',
      });
    }

    return { files, headSha, url: mr.web_url };
  }

  private async fetchFileContent(token: string, projectId: number, path: string, ref: string): Promise<string | null> {
    const encodedPath = encodeURIComponent(path);
    const res = await fetch(
      `${this.baseUrl()}/projects/${projectId}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(ref)}`,
      { headers: this.authHeaders(token) },
    );
    if (!res.ok) return null;
    return res.text();
  }
}
