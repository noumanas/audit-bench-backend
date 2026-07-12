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
exports.GitlabService = void 0;
const common_1 = require("@nestjs/common");
const crypto = require("crypto");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
const diff_ranges_1 = require("../common/diff-ranges");
const pr_feedback_service_1 = require("../pr-feedback/pr-feedback.service");
const gitlab_url_1 = require("../common/gitlab-url");
let GitlabService = class GitlabService {
    prisma;
    config;
    prFeedback;
    constructor(prisma, config, prFeedback) {
        this.prisma = prisma;
        this.config = config;
        this.prFeedback = prFeedback;
    }
    onModuleInit() {
        this.prFeedback.register('gitlab', this);
    }
    baseUrl() {
        return this.config.get('GITLAB_BASE_URL') || 'https://gitlab.com/api/v4';
    }
    authHeaders(token) {
        return { Authorization: `Bearer ${token}`, 'User-Agent': 'ai-code-auditor' };
    }
    async requireToken(userId) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        if (!user.gitlabToken) {
            throw new common_1.BadRequestException('Connect a GitLab account first');
        }
        if (user.gitlabRefreshToken && user.gitlabTokenExpiresAt && user.gitlabTokenExpiresAt.getTime() - Date.now() < 60_000) {
            return this.refreshAccessToken(userId, user.gitlabRefreshToken);
        }
        return user.gitlabToken;
    }
    async refreshAccessToken(userId, refreshToken) {
        const clientId = this.config.get('GITLAB_OAUTH_CLIENT_ID');
        const clientSecret = this.config.get('GITLAB_OAUTH_CLIENT_SECRET');
        if (!clientId || !clientSecret) {
            return (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).gitlabToken;
        }
        const res = await fetch(`${(0, gitlab_url_1.gitlabInstanceUrl)((k) => this.config.get(k))}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
        });
        if (!res.ok) {
            throw new common_1.BadRequestException('Your GitLab session expired and could not be refreshed — reconnect GitLab.');
        }
        const data = await res.json();
        await this.prisma.user.update({
            where: { id: userId },
            data: {
                gitlabToken: data.access_token,
                gitlabRefreshToken: data.refresh_token ?? refreshToken,
                gitlabTokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
            },
        });
        return data.access_token;
    }
    async connect(userId, token) {
        const res = await fetch(`${this.baseUrl()}/user`, { headers: this.authHeaders(token) });
        if (!res.ok) {
            throw new common_1.BadRequestException(res.status === 401
                ? 'That GitLab token was rejected — check it has "read_api" (or "api") scope and hasn\'t expired'
                : `GitLab rejected the request (${res.status})`);
        }
        const profile = await res.json();
        await this.prisma.user.update({
            where: { id: userId },
            data: { gitlabToken: token, gitlabUsername: profile.username },
        });
        return { username: profile.username };
    }
    async disconnect(userId) {
        await this.prisma.user.update({
            where: { id: userId },
            data: { gitlabToken: null, gitlabUsername: null },
        });
    }
    async status(userId) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        return { connected: Boolean(user.gitlabToken), username: user.gitlabUsername };
    }
    async listProjects(userId) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${this.baseUrl()}/projects?membership=true&per_page=100&order_by=last_activity_at&sort=desc`, {
            headers: this.authHeaders(token),
        });
        if (!res.ok) {
            throw new common_1.BadRequestException(`GitLab rejected the request (${res.status}) — token may be invalid or expired`);
        }
        const projects = await res.json();
        return projects.map((p) => ({
            id: p.id,
            pathWithNamespace: p.path_with_namespace,
            name: p.name,
            private: p.visibility !== 'public',
            description: p.description,
            defaultBranch: p.default_branch,
            updatedAt: p.last_activity_at,
            webUrl: p.web_url,
        }));
    }
    async listBranches(userId, projectId) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${this.baseUrl()}/projects/${projectId}/repository/branches?per_page=100`, {
            headers: this.authHeaders(token),
        });
        if (res.status === 404) {
            throw new common_1.NotFoundException(`Project ${projectId} not found or not accessible with this token`);
        }
        if (!res.ok) {
            throw new common_1.BadRequestException(`GitLab rejected the request (${res.status})`);
        }
        const branches = await res.json();
        return branches.map((b) => b.name);
    }
    async downloadProjectZip(userId, projectId, ref) {
        const token = await this.requireToken(userId);
        const query = ref ? `?sha=${encodeURIComponent(ref)}` : '';
        const res = await fetch(`${this.baseUrl()}/projects/${projectId}/repository/archive.zip${query}`, {
            headers: this.authHeaders(token),
        });
        if (res.status === 404) {
            throw new common_1.NotFoundException(`Project ${projectId} not found or not accessible with this token`);
        }
        if (!res.ok) {
            throw new common_1.BadRequestException(`GitLab rejected the download (${res.status})`);
        }
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
    async fetchMrFiles(userId, projectId, mrIid) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${this.baseUrl()}/projects/${projectId}/merge_requests/${mrIid}/changes`, {
            headers: this.authHeaders(token),
        });
        if (res.status === 404) {
            throw new common_1.NotFoundException(`MR !${mrIid} not found in project ${projectId}, or not accessible with this token`);
        }
        if (!res.ok)
            throw new common_1.BadRequestException(`GitLab rejected the request (${res.status})`);
        const mr = await res.json();
        const headSha = mr.diff_refs?.head_sha;
        const diffRefs = {
            baseSha: mr.diff_refs?.base_sha,
            startSha: mr.diff_refs?.start_sha,
            headSha,
        };
        const files = [];
        for (const c of mr.changes || []) {
            if (c.deleted_file || !c.diff)
                continue;
            const content = await this.fetchFileContent(token, projectId, c.new_path, headSha);
            if (content === null)
                continue;
            files.push({
                path: c.new_path,
                content,
                changedRanges: (0, diff_ranges_1.parseChangedRanges)(c.diff),
                status: c.new_file ? 'added' : c.renamed_file ? 'renamed' : 'modified',
            });
        }
        return {
            files,
            headSha,
            url: mr.web_url,
            diffRefs,
            sourceBranch: mr.source_branch,
            targetBranch: mr.target_branch,
        };
    }
    async fetchFileContent(token, projectId, path, ref) {
        const encodedPath = encodeURIComponent(path);
        const res = await fetch(`${this.baseUrl()}/projects/${projectId}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(ref)}`, { headers: this.authHeaders(token) });
        if (!res.ok)
            return null;
        return res.text();
    }
    async getProjectMeta(userId, projectId) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${this.baseUrl()}/projects/${projectId}`, { headers: this.authHeaders(token) });
        if (res.status === 404)
            throw new common_1.NotFoundException(`Project ${projectId} not found or not accessible with this token`);
        if (!res.ok)
            throw new common_1.BadRequestException(`GitLab rejected the request (${res.status})`);
        const data = await res.json();
        return { defaultBranch: data.default_branch };
    }
    async getFileAtRef(userId, projectId, path, ref) {
        const token = await this.requireToken(userId);
        const content = await this.fetchFileContent(token, projectId, path, ref);
        if (content === null)
            throw new common_1.NotFoundException(`${path} not found at ${ref}`);
        return content;
    }
    async commitFile(userId, projectId, branch, path, content, message, startBranch) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${this.baseUrl()}/projects/${projectId}/repository/commits`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                branch,
                commit_message: message,
                ...(startBranch ? { start_branch: startBranch } : {}),
                actions: [{ action: 'update', file_path: path, content }],
            }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new common_1.BadRequestException(`GitLab rejected the commit (${res.status})${body.message ? `: ${body.message}` : ''}`);
        }
        const data = await res.json();
        return data.web_url || '';
    }
    async createMergeRequest(userId, projectId, sourceBranch, targetBranch, title, description) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${this.baseUrl()}/projects/${projectId}/merge_requests`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_branch: sourceBranch, target_branch: targetBranch, title, description }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new common_1.BadRequestException(`GitLab rejected creating the merge request (${res.status})${body.message ? `: ${body.message}` : ''}`);
        }
        const data = await res.json();
        return { url: data.web_url, iid: data.iid };
    }
    async publish(userId, context, feedback) {
        const token = await this.requireToken(userId);
        await this.postMrDiscussions(token, context.projectId, context.mrIid, context.diffRefs, feedback);
        await this.postMrNoteWithToken(token, context.projectId, context.mrIid, buildSummaryBody(feedback));
        await this.postCommitStatus(token, context.projectId, context.headSha, feedback);
    }
    async postMrDiscussions(token, projectId, mrIid, diffRefs, feedback) {
        const inline = feedback.findings.filter((f) => f.line !== null).slice(0, 50);
        for (const f of inline) {
            const body = `**${severityLabel(f.severity)} — ${f.title}**\n\n${f.description}`;
            const res = await fetch(`${this.baseUrl()}/projects/${projectId}/merge_requests/${mrIid}/discussions`, {
                method: 'POST',
                headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    body,
                    position: {
                        position_type: 'text',
                        base_sha: diffRefs.baseSha,
                        start_sha: diffRefs.startSha,
                        head_sha: diffRefs.headSha,
                        new_path: f.path,
                        new_line: f.line,
                    },
                }),
            });
            if (!res.ok) {
                await this.postMrNoteWithToken(token, projectId, mrIid, body);
            }
        }
    }
    async postMrNote(userId, projectId, mrIid, body) {
        const token = await this.requireToken(userId);
        await this.postMrNoteWithToken(token, projectId, mrIid, body);
    }
    async postMrNoteWithToken(token, projectId, mrIid, body) {
        await fetch(`${this.baseUrl()}/projects/${projectId}/merge_requests/${mrIid}/notes`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
        });
    }
    async postCommitStatus(token, projectId, sha, feedback) {
        const { state, description } = commitStatusFor(feedback);
        await fetch(`${this.baseUrl()}/projects/${projectId}/statuses/${sha}`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ state, description, name: 'audit/bench' }),
        });
    }
    static verifyWebhookToken(secret, tokenHeader) {
        if (!tokenHeader)
            return false;
        const secretBuf = Buffer.from(secret);
        const providedBuf = Buffer.from(tokenHeader);
        return secretBuf.length === providedBuf.length && crypto.timingSafeEqual(secretBuf, providedBuf);
    }
};
exports.GitlabService = GitlabService;
exports.GitlabService = GitlabService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        pr_feedback_service_1.PrFeedbackService])
], GitlabService);
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
        return { state: 'failed', description: 'audit/bench found blocking issues — see review comments' };
    }
    if (feedback.verdict === 'needs_work') {
        return { state: 'success', description: 'audit/bench found issues worth reviewing' };
    }
    return { state: 'success', description: 'audit/bench found no issues' };
}
//# sourceMappingURL=gitlab.service.js.map