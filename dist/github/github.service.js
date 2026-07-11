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
const crypto = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const diff_ranges_1 = require("../common/diff-ranges");
const pr_feedback_service_1 = require("../pr-feedback/pr-feedback.service");
const GITHUB_API = 'https://api.github.com';
let GithubService = class GithubService {
    prisma;
    prFeedback;
    constructor(prisma, prFeedback) {
        this.prisma = prisma;
        this.prFeedback = prFeedback;
    }
    onModuleInit() {
        this.prFeedback.register('github', this);
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
        return { files, headSha, url: pr.html_url, headRef: pr.head.ref, baseRef: pr.base.ref };
    }
    async getRepoMeta(userId, owner, repo) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: this.authHeaders(token) });
        if (res.status === 404)
            throw new common_1.NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
        if (!res.ok)
            throw new common_1.BadRequestException(`GitHub rejected the request (${res.status})`);
        const data = await res.json();
        return { defaultBranch: data.default_branch };
    }
    async getFileAtRef(userId, owner, repo, path, ref) {
        const token = await this.requireToken(userId);
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`, {
            headers: this.authHeaders(token),
        });
        if (res.status === 404)
            throw new common_1.NotFoundException(`${path} not found at ${ref}`);
        if (!res.ok)
            throw new common_1.BadRequestException(`GitHub rejected the request (${res.status})`);
        const data = await res.json();
        if (data.encoding !== 'base64' || typeof data.content !== 'string') {
            throw new common_1.BadRequestException('Unexpected content encoding from GitHub');
        }
        return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
    }
    async getBranchHeadSha(userId, owner, repo, branch) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
            headers: this.authHeaders(token),
        });
        if (!res.ok)
            throw new common_1.BadRequestException(`GitHub rejected resolving branch "${branch}" (${res.status})`);
        const data = await res.json();
        return data.object.sha;
    }
    async createBranch(userId, owner, repo, newBranch, fromSha) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
        });
        if (!res.ok)
            throw new common_1.BadRequestException(`GitHub rejected creating branch "${newBranch}" (${res.status})`);
    }
    async commitFileUpdate(userId, owner, repo, path, branch, content, message, sha) {
        const token = await this.requireToken(userId);
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}`, {
            method: 'PUT',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), sha, branch }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new common_1.BadRequestException(`GitHub rejected the commit (${res.status})${body.message ? `: ${body.message}` : ''}`);
        }
        const data = await res.json();
        return data.commit?.html_url || '';
    }
    async createPullRequest(userId, owner, repo, title, head, base, body) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, head, base, body }),
        });
        if (!res.ok) {
            const respBody = await res.json().catch(() => ({}));
            throw new common_1.BadRequestException(`GitHub rejected creating the pull request (${res.status})${respBody.message ? `: ${respBody.message}` : ''}`);
        }
        const data = await res.json();
        return { url: data.html_url, number: data.number };
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
    async publish(userId, context, feedback) {
        const token = await this.requireToken(userId);
        await this.postPrReview(token, context.owner, context.repo, context.pullNumber, context.headSha, feedback);
        await this.postCommitStatus(token, context.owner, context.repo, context.headSha, feedback);
    }
    async postPrReview(token, owner, repo, pullNumber, headSha, feedback) {
        const comments = feedback.findings
            .filter((f) => f.line !== null)
            .slice(0, 50)
            .map((f) => ({
            path: f.path,
            line: f.line,
            body: `**${severityLabel(f.severity)} — ${f.title}**\n\n${f.description}`,
        }));
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                commit_id: headSha,
                body: buildSummaryBody(feedback),
                event: 'COMMENT',
                comments,
            }),
        });
        if (!res.ok) {
            await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
                method: 'POST',
                headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
                body: JSON.stringify({ body: buildSummaryBody(feedback) }),
            });
        }
    }
    async postCommitStatus(token, owner, repo, sha, feedback) {
        const { state, description } = commitStatusFor(feedback);
        await fetch(`${GITHUB_API}/repos/${owner}/${repo}/statuses/${sha}`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ state, description, context: 'audit/bench' }),
        });
    }
    async postIssueComment(userId, owner, repo, issueNumber, body) {
        const token = await this.requireToken(userId);
        await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
        });
    }
    static verifyWebhookSignature(secret, rawBody, signatureHeader) {
        if (!signatureHeader?.startsWith('sha256='))
            return false;
        const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const provided = signatureHeader.slice('sha256='.length);
        const expectedBuf = Buffer.from(expected, 'hex');
        const providedBuf = Buffer.from(provided, 'hex');
        return expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
    }
};
exports.GithubService = GithubService;
exports.GithubService = GithubService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        pr_feedback_service_1.PrFeedbackService])
], GithubService);
function severityLabel(severity) {
    const icons = { critical: '🔴 Critical', high: '🟠 High', medium: '🟡 Medium', low: '🔵 Low' };
    return icons[severity] || severity;
}
function buildSummaryBody(feedback) {
    const verdictLabel = { pass: '✅ Pass', needs_work: '⚠️ Needs work', do_not_ship: '⛔ Do not ship' }[feedback.verdict];
    const counts = feedback.findings.reduce((acc, f) => {
        acc[f.severity] = (acc[f.severity] || 0) + 1;
        return acc;
    }, {});
    const countLine = ['critical', 'high', 'medium', 'low']
        .filter((s) => counts[s])
        .map((s) => `${counts[s]} ${s}`)
        .join(', ');
    const lines = [
        `### audit/bench review — ${verdictLabel}`,
        '',
        feedback.summary,
        '',
        countLine ? `**Findings:** ${countLine}` : '_No findings — all clear._',
    ];
    if (feedback.scanUrl)
        lines.push('', `[View full report](${feedback.scanUrl})`);
    return lines.join('\n');
}
function commitStatusFor(feedback) {
    if (feedback.verdict === 'do_not_ship') {
        return { state: 'failure', description: 'audit/bench found blocking issues — see review comments' };
    }
    if (feedback.verdict === 'needs_work') {
        return { state: 'success', description: 'audit/bench found issues worth reviewing' };
    }
    return { state: 'success', description: 'audit/bench found no issues' };
}
//# sourceMappingURL=github.service.js.map