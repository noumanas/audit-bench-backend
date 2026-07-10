"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const diff_ranges_1 = require("../common/diff-ranges");
const GITHUB_API = 'https://api.github.com';
let GithubService = class GithubService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    authHeaders(token) {
        return {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'ai-code-auditor',
        };
    }
    async requireToken(userId) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        if (!user.githubToken) {
            throw new common_1.BadRequestException('Connect a GitHub account first');
        }
        return user.githubToken;
    }
    async connect(userId, token) {
        const res = await fetch(`${GITHUB_API}/user`, { headers: this.authHeaders(token) });
        if (!res.ok) {
            throw new common_1.BadRequestException(res.status === 401
                ? 'That GitHub token was rejected — check it has "repo" scope and hasn\'t expired'
                : `GitHub rejected the request (${res.status})`);
        }
        const profile = await res.json();
        await this.prisma.user.update({
            where: { id: userId },
            data: { githubToken: token, githubUsername: profile.login },
        });
        return { username: profile.login };
    }
    async disconnect(userId) {
        await this.prisma.user.update({
            where: { id: userId },
            data: { githubToken: null, githubUsername: null },
        });
    }
    async status(userId) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        return { connected: Boolean(user.githubToken), username: user.githubUsername };
    }
    async listRepos(userId) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${GITHUB_API}/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member`, {
            headers: this.authHeaders(token),
        });
        if (!res.ok) {
            throw new common_1.BadRequestException(`GitHub rejected the request (${res.status}) — token may be invalid or expired`);
        }
        const repos = await res.json();
        return repos.map((r) => ({
            id: r.id,
            owner: r.owner.login,
            name: r.name,
            fullName: r.full_name,
            private: r.private,
            description: r.description,
            defaultBranch: r.default_branch,
            updatedAt: r.updated_at,
            htmlUrl: r.html_url,
        }));
    }
    async listBranches(userId, owner, repo) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/branches?per_page=100`, {
            headers: this.authHeaders(token),
        });
        if (res.status === 404) {
            throw new common_1.NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
        }
        if (!res.ok) {
            throw new common_1.BadRequestException(`GitHub rejected the request (${res.status})`);
        }
        const branches = await res.json();
        return branches.map((b) => b.name);
    }
    async downloadRepoZip(userId, owner, repo, ref) {
        const token = await this.requireToken(userId);
        const path = ref ? `${owner}/${repo}/zipball/${ref}` : `${owner}/${repo}/zipball`;
        const res = await fetch(`${GITHUB_API}/repos/${path}`, { headers: this.authHeaders(token) });
        if (res.status === 404) {
            throw new common_1.NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
        }
        if (!res.ok) {
            throw new common_1.BadRequestException(`GitHub rejected the download (${res.status})`);
        }
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
    async fetchPrFiles(userId, owner, repo, pullNumber) {
        const token = await this.requireToken(userId);
        const prRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}`, {
            headers: this.authHeaders(token),
        });
        if (prRes.status === 404) {
            throw new common_1.NotFoundException(`PR #${pullNumber} not found in ${owner}/${repo}, or not accessible with this token`);
        }
        if (!prRes.ok)
            throw new common_1.BadRequestException(`GitHub rejected the request (${prRes.status})`);
        const pr = await prRes.json();
        const headSha = pr.head.sha;
        const filesRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`, {
            headers: this.authHeaders(token),
        });
        if (!filesRes.ok)
            throw new common_1.BadRequestException(`GitHub rejected the request (${filesRes.status})`);
        const rawFiles = await filesRes.json();
        const files = [];
        for (const f of rawFiles) {
            if (f.status === 'removed' || !f.patch)
                continue;
            const content = await this.fetchFileContent(token, owner, repo, f.filename, headSha);
            if (content === null)
                continue;
            files.push({
                path: f.filename,
                content,
                changedRanges: (0, diff_ranges_1.parseChangedRanges)(f.patch),
                status: f.status,
            });
        }
        return { files, headSha, url: pr.html_url };
    }
    async fetchFileContent(token, owner, repo, path, ref) {
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${ref}`, {
            headers: this.authHeaders(token),
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        if (data.encoding !== 'base64' || typeof data.content !== 'string')
            return null;
        return Buffer.from(data.content, 'base64').toString('utf8');
    }
};
exports.GithubService = GithubService;
exports.GithubService = GithubService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GithubService);
//# sourceMappingURL=github.service.js.map