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
exports.mapGithubContributorStats = mapGithubContributorStats;
exports.buildSummaryBody = buildSummaryBody;
exports.explainPostFailure = explainPostFailure;
const common_1 = require("@nestjs/common");
const git_host_errors_1 = require("../common/git-host-errors");
const crypto = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const diff_ranges_1 = require("../common/diff-ranges");
const pr_feedback_service_1 = require("../pr-feedback/pr-feedback.service");
const pr_feedback_types_1 = require("../pr-feedback/pr-feedback.types");
const inline_comment_1 = require("../pr-feedback/inline-comment");
const token_crypto_service_1 = require("../common/token-crypto.service");
const github_pr_snapshot_1 = require("../common/github-pr-snapshot");
const GITHUB_API = 'https://api.github.com';
let GithubService = class GithubService {
    prisma;
    prFeedback;
    tokenCrypto;
    constructor(prisma, prFeedback, tokenCrypto) {
        this.prisma = prisma;
        this.prFeedback = prFeedback;
        this.tokenCrypto = tokenCrypto;
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
        return this.tokenCrypto.decrypt(user.githubToken);
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
            data: { githubToken: this.tokenCrypto.encrypt(token), githubUsername: profile.login },
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
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
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
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
        }
        const branches = await res.json();
        return branches.map((b) => b.name);
    }
    async listPullRequests(userId, owner, repo) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&per_page=100`, {
            headers: this.authHeaders(token),
        });
        if (res.status === 404) {
            throw new common_1.NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
        }
        if (!res.ok) {
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
        }
        const pulls = await res.json();
        return pulls.map((p) => ({
            number: p.number,
            title: p.title,
            headRef: p.head.ref,
            baseRef: p.base.ref,
            draft: Boolean(p.draft),
            updatedAt: p.updated_at,
            htmlUrl: p.html_url,
        }));
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
    async fetchContributorStats(userId, owner, repo) {
        const token = await this.requireToken(userId);
        const raw = await this.requestContributorStats(token, owner, repo);
        return raw ? mapGithubContributorStats(raw) : [];
    }
    async requestContributorStats(token, owner, repo) {
        for (let attempt = 0; attempt < 2; attempt++) {
            const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/stats/contributors`, {
                headers: this.authHeaders(token),
            });
            if (res.status === 202) {
                if (attempt === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                    continue;
                }
                return null;
            }
            if (!res.ok)
                return null;
            const body = await res.json();
            return Array.isArray(body) ? body : null;
        }
        return null;
    }
    async fetchPrFiles(userId, owner, repo, pullNumber, opts = {}) {
        const token = await this.requireToken(userId);
        const prRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}`, {
            headers: this.authHeaders(token),
        });
        if (prRes.status === 404) {
            throw new common_1.NotFoundException(`PR #${pullNumber} not found in ${owner}/${repo}, or not accessible with this token`);
        }
        if (!prRes.ok)
            throw new common_1.BadRequestException(`GitHub rejected the request (${prRes.status})`);
        let pr = (await prRes.json());
        if (opts.withSnapshot)
            pr = await (0, github_pr_snapshot_1.refetchIfMergeabilityPending)(pr, this.authHeaders(token), owner, repo, pullNumber);
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
        const snapshot = opts.withSnapshot
            ? (0, github_pr_snapshot_1.toPrSnapshot)(pr, owner, repo, pullNumber, await (0, github_pr_snapshot_1.fetchCiChecks)(this.authHeaders(token), owner, repo, headSha), files.length, rawFiles.length)
            : undefined;
        return { files, headSha, url: pr.html_url, headRef: pr.head.ref, baseRef: pr.base.ref, snapshot };
    }
    async getRepoMeta(userId, owner, repo) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: this.authHeaders(token) });
        if (res.status === 404)
            throw new common_1.NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
        if (!res.ok)
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
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
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
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
            .map((f) => ({ f, at: (0, inline_comment_1.commentLines)(f, feedback.changedRanges?.[f.path]) }))
            .filter((c) => c.at !== null)
            .slice(0, 50)
            .map(({ f, at }) => ({
            path: f.path,
            ...(at.end > at.start ? { start_line: at.start, start_side: 'RIGHT' } : {}),
            line: at.end,
            side: 'RIGHT',
            body: (0, inline_comment_1.inlineCommentBody)(f),
        }));
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                commit_id: headSha,
                body: buildSummaryBody(feedback, { posted: comments.length, headSha }),
                event: 'COMMENT',
                comments,
            }),
        });
        if (res.ok)
            return;
        const reviewError = await githubErrorMessage(res);
        const fallback = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: buildSummaryBody(feedback, { posted: 0, headSha }) }),
        });
        if (fallback.ok)
            return;
        throw new Error(explainPostFailure(fallback.status, (await githubErrorMessage(fallback)) || reviewError));
    }
    async postCommitStatus(token, owner, repo, sha, feedback) {
        const { state, description } = commitStatusFor(feedback);
        await fetch(`${GITHUB_API}/repos/${owner}/${repo}/statuses/${sha}`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ state, description, context: 'audit/bench' }),
        });
    }
    async getReviewComment(userId, owner, repo, commentId) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/comments/${commentId}`, {
            headers: this.authHeaders(token),
        });
        if (!res.ok)
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
        return (await res.json());
    }
    async listReviewThread(userId, owner, repo, pullNumber, rootId) {
        const token = await this.requireToken(userId);
        const thread = [];
        for (let page = 1; page <= 5; page++) {
            const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/comments?per_page=100&page=${page}`, { headers: this.authHeaders(token) });
            if (!res.ok)
                throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
            const batch = (await res.json());
            thread.push(...batch.filter((c) => c.id === rootId || c.in_reply_to_id === rootId));
            if (batch.length < 100)
                break;
        }
        return thread.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    async replyToReviewComment(userId, owner, repo, pullNumber, rootId, body) {
        const token = await this.requireToken(userId);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/comments/${rootId}/replies`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
        });
        if (!res.ok)
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
    }
    async resolveReviewThread(userId, owner, repo, pullNumber, rootId) {
        const token = await this.requireToken(userId);
        const graphql = async (query, variables) => {
            const res = await fetch(`${GITHUB_API}/graphql`, {
                method: 'POST',
                headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, variables }),
            });
            return res.ok ? (await res.json()) : { errors: [res.status] };
        };
        const found = await graphql(`query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
          reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { databaseId } } } }
        } }
      }`, { owner, repo, number: pullNumber });
        const threads = found.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
        const thread = threads.find((t) => t.comments.nodes[0]?.databaseId === rootId);
        if (!thread)
            return false;
        if (thread.isResolved)
            return true;
        const done = await graphql(`mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }`, { id: thread.id });
        return Boolean(done.data?.resolveReviewThread?.thread?.isResolved);
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
        pr_feedback_service_1.PrFeedbackService,
        token_crypto_service_1.TokenCryptoService])
], GithubService);
function mapGithubContributorStats(raw) {
    return raw
        .filter((entry) => Boolean(entry) && typeof entry.total === 'number')
        .map((entry) => {
        const weeks = Array.isArray(entry.weeks) ? entry.weeks : [];
        const additions = weeks.reduce((sum, w) => sum + (w.a || 0), 0);
        const deletions = weeks.reduce((sum, w) => sum + (w.d || 0), 0);
        const lastActiveWeek = [...weeks].reverse().find((w) => (w.c || 0) > 0);
        return {
            author: entry.author?.login || 'unknown',
            commits: entry.total,
            additions,
            deletions,
            lastCommitAt: lastActiveWeek ? new Date(lastActiveWeek.w * 1000).toISOString() : null,
        };
    })
        .sort((a, b) => b.commits - a.commits);
}
function buildSummaryBody(feedback, opts = {}) {
    const verdictLabel = { pass: '✅ Pass', needs_work: '⚠️ Needs work', do_not_ship: '⛔ Do not ship' }[feedback.verdict];
    const counts = feedback.findings.reduce((acc, f) => {
        acc[f.severity] = (acc[f.severity] || 0) + 1;
        return acc;
    }, {});
    const countLine = ['critical', 'high', 'medium', 'low']
        .filter((s) => counts[s])
        .map((s) => `${counts[s]} ${s}`)
        .join(', ');
    const lines = [`### Audit Bench Ai review — ${verdictLabel}`, ''];
    if (opts.posted !== undefined)
        lines.push(`**Actionable comments posted: ${opts.posted}**`, '');
    if (feedback.readiness)
        lines.push(...readinessLines(feedback.readiness), '');
    lines.push(countLine ? `**Findings:** ${countLine}` : '_No findings — all clear._');
    if (feedback.findings.length) {
        lines.push('', '---', '', '<details>', '<summary>🤖 Prompt to fix review comments</summary>', '', '````text', 'Verify each finding against the current code and only fix it if it still applies.', '', ...feedback.findings.slice(0, 50).flatMap((f) => [
            `In \`@${f.path}\`${f.line ? ` around ${f.endLine && f.endLine > f.line ? `lines ${f.line} - ${f.endLine}` : `line ${f.line}`}` : ''}: ${f.title}. ${f.description}${f.suggestedFix ? ` Suggested fix: ${f.suggestedFix}` : ''}`,
            '',
        ]), '````', '', '</details>');
    }
    const info = [
        opts.headSha ? `- **Commit:** \`${opts.headSha.slice(0, 7)}\`` : null,
        `- **Verdict:** ${verdictLabel}`,
        `- **Scope:** ${feedback.summary}`,
    ].filter(Boolean);
    lines.push('', '<details>', '<summary>ℹ️ Review info</summary>', '', ...info, '', '</details>');
    lines.push('', '💬 Reply to any inline comment and Audit Bench Ai will recheck that code and answer in the thread. Mention `@auditbench` in the conversation to ask about the whole PR.');
    if (feedback.scanUrl)
        lines.push('', `[View the full report and fix with AI](${feedback.scanUrl})`);
    lines.push('', pr_feedback_types_1.REVIEW_FOOTER);
    return lines.join('\n');
}
const READINESS_LABEL = {
    ready: '✅ Ready to merge',
    ready_with_notes: '🟡 Ready to merge, with notes',
    not_ready: '⛔ Not ready to merge',
    merged: '🟣 Already merged',
    closed: '⚪ Closed without merging',
};
async function githubErrorMessage(res) {
    try {
        const body = (await res.json());
        return body.message ?? '';
    }
    catch {
        return '';
    }
}
function explainPostFailure(status, message) {
    const base = `GitHub refused the comment (${status}${message ? `: ${message}` : ''}).`;
    if (/personal access token/i.test(message)) {
        return `${base} Fine-grained tokens can only comment on repositories they were granted access to. To comment on other people's public repositories, reconnect GitHub with a classic token that has the public_repo scope.`;
    }
    if (status === 401)
        return `${base} The GitHub token has expired or been revoked; reconnect GitHub with a new token.`;
    if (status === 403 && /locked|limited/i.test(message))
        return `${base} The conversation is locked or limited to collaborators.`;
    if (status === 403 || status === 404) {
        return `${base} The token can't write to this repository. Check its scopes (repo or public_repo) and that it can access the repository.`;
    }
    return base;
}
function readinessLines(readiness) {
    const lines = [`**Merge readiness: ${READINESS_LABEL[readiness.status]}**`];
    if (readiness.blockers.length)
        lines.push('', '_Fix before merging:_', ...readiness.blockers.map((b) => `- ${b}`));
    if (readiness.notes.length)
        lines.push('', '_Worth a look:_', ...readiness.notes.map((n) => `- ${n}`));
    return lines;
}
function commitStatusFor(feedback) {
    if (feedback.verdict === 'do_not_ship') {
        return { state: 'failure', description: 'Audit Bench Ai found blocking issues — see review comments' };
    }
    if (feedback.verdict === 'needs_work') {
        return { state: 'success', description: 'Audit Bench Ai found issues worth reviewing' };
    }
    return { state: 'success', description: 'Audit Bench Ai found no issues' };
}
//# sourceMappingURL=github.service.js.map