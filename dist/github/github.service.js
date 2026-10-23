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
var GithubService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSummaryBody = exports.GithubService = void 0;
exports.mapGithubContributorStats = mapGithubContributorStats;
exports.explainPostFailure = explainPostFailure;
const common_1 = require("@nestjs/common");
const git_host_errors_1 = require("../common/git-host-errors");
const crypto = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const diff_ranges_1 = require("../common/diff-ranges");
const pr_feedback_service_1 = require("../pr-feedback/pr-feedback.service");
const inline_comment_1 = require("../pr-feedback/inline-comment");
const token_crypto_service_1 = require("../common/token-crypto.service");
const github_app_auth_service_1 = require("./github-app-auth.service");
const file_walker_1 = require("../analysis/file-walker");
const summary_comment_1 = require("../pr-feedback/summary-comment");
Object.defineProperty(exports, "buildSummaryBody", { enumerable: true, get: function () { return summary_comment_1.buildSummaryBody; } });
const check_run_1 = require("../pr-feedback/check-run");
const github_pr_snapshot_1 = require("../common/github-pr-snapshot");
const GITHUB_API = 'https://api.github.com';
const REPO_CONTEXT_MAX_KB = 50 * 1024;
let GithubService = GithubService_1 = class GithubService {
    prisma;
    prFeedback;
    tokenCrypto;
    appAuth;
    logger = new common_1.Logger(GithubService_1.name);
    constructor(prisma, prFeedback, tokenCrypto, appAuth) {
        this.prisma = prisma;
        this.prFeedback = prFeedback;
        this.tokenCrypto = tokenCrypto;
        this.appAuth = appAuth;
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
    async requireToken(auth) {
        if (typeof auth !== 'string')
            return this.appAuth.installationToken(auth.installationId);
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth } });
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
    async listRepos(auth) {
        const token = await this.requireToken(auth);
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
    async listBranches(auth, owner, repo) {
        const token = await this.requireToken(auth);
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
    async listPullRequests(auth, owner, repo) {
        const token = await this.requireToken(auth);
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
    async downloadRepoZip(auth, owner, repo, ref) {
        const token = await this.requireToken(auth);
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
    async fetchContributorStats(auth, owner, repo) {
        const token = await this.requireToken(auth);
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
    async fetchPrFiles(auth, owner, repo, pullNumber, opts = {}) {
        const token = await this.requireToken(auth);
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
        const repoFiles = opts.withRepoContext
            ? await this.repoFilesForContext(auth, owner, repo, headSha, pr.base.repo.size)
            : undefined;
        return { files, headSha, url: pr.html_url, headRef: pr.head.ref, baseRef: pr.base.ref, snapshot, repoFiles };
    }
    async repoFilesForContext(auth, owner, repo, sha, sizeKb) {
        if (sizeKb !== undefined && sizeKb > REPO_CONTEXT_MAX_KB)
            return undefined;
        try {
            return (0, file_walker_1.extractZip)(await this.downloadRepoZip(auth, owner, repo, sha), 200_000);
        }
        catch {
            return undefined;
        }
    }
    async getRepoMeta(auth, owner, repo) {
        const token = await this.requireToken(auth);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: this.authHeaders(token) });
        if (res.status === 404)
            throw new common_1.NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
        if (!res.ok)
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
        const data = await res.json();
        return { defaultBranch: data.default_branch };
    }
    async getFileAtRef(auth, owner, repo, path, ref) {
        const token = await this.requireToken(auth);
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
    async getBranchHeadSha(auth, owner, repo, branch) {
        const token = await this.requireToken(auth);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
            headers: this.authHeaders(token),
        });
        if (!res.ok)
            throw new common_1.BadRequestException(`GitHub rejected resolving branch "${branch}" (${res.status})`);
        const data = await res.json();
        return data.object.sha;
    }
    async createBranch(auth, owner, repo, newBranch, fromSha) {
        const token = await this.requireToken(auth);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
        });
        if (!res.ok)
            throw new common_1.BadRequestException(`GitHub rejected creating branch "${newBranch}" (${res.status})`);
    }
    async commitFileUpdate(auth, owner, repo, path, branch, content, message, sha) {
        const token = await this.requireToken(auth);
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
    async createPullRequest(auth, owner, repo, title, head, base, body) {
        const token = await this.requireToken(auth);
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
        const token = await this.requireToken(context.installationId ? { installationId: context.installationId } : userId);
        await this.postPrReview(token, context.owner, context.repo, context.pullNumber, context.headSha, feedback);
        if (!context.installationId) {
            await this.postCommitStatus(token, context.owner, context.repo, context.headSha, feedback);
            return;
        }
        try {
            await this.postCheckRun(token, context.owner, context.repo, context.headSha, feedback, context.checkRunId);
        }
        catch (err) {
            this.logger.warn(`Check run refused on ${context.owner}/${context.repo}, posting a commit status instead: ${err.message}`);
            const res = await this.postCommitStatus(token, context.owner, context.repo, context.headSha, feedback);
            if (!res.every((r) => r.ok)) {
                throw new Error(`The review was posted, but GitHub refused its pass/fail check. ${err.message}`);
            }
        }
    }
    async postCheckRun(token, owner, repo, sha, feedback, checkRunId) {
        const body = { ...(0, check_run_1.buildCheckRun)(feedback, sha), completed_at: new Date().toISOString() };
        const res = checkRunId
            ? await fetch(`${GITHUB_API}/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
                method: 'PATCH',
                headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            : await fetch(`${GITHUB_API}/repos/${owner}/${repo}/check-runs`, {
                method: 'POST',
                headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        if (!res.ok)
            throw new Error(explainPostFailure(res.status, await githubErrorMessage(res)));
    }
    async startReviewStatus(auth, owner, repo, sha) {
        try {
            const token = await this.requireToken(auth);
            if (typeof auth !== 'string') {
                const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/check-runs`, {
                    method: 'POST',
                    headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
                    body: JSON.stringify((0, check_run_1.inProgressCheckRun)(sha)),
                });
                return res.ok ? (await res.json()).id : undefined;
            }
            await this.postStatuses(token, owner, repo, sha, {
                state: 'pending',
                description: 'Audit Bench Ai is reviewing this commit…',
            });
        }
        catch (err) {
        }
        return undefined;
    }
    async fail(userId, context, reason) {
        await this.stopReviewStatus(context.installationId ? { installationId: context.installationId } : userId, context.owner, context.repo, context.headSha, reason, context.checkRunId);
    }
    async stopReviewStatus(auth, owner, repo, sha, reason, checkRunId) {
        const token = await this.requireToken(auth);
        if (checkRunId) {
            await fetch(`${GITHUB_API}/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
                method: 'PATCH',
                headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
                body: JSON.stringify((0, check_run_1.stoppedCheckRun)(reason)),
            });
        }
        else if (typeof auth === 'string') {
            await this.postStatuses(token, owner, repo, sha, { state: 'success', description: reason.slice(0, 140) });
        }
    }
    async postReviewWithToken(token, owner, repo, pullNumber, headSha, feedback) {
        await this.postPrReview(token, owner, repo, pullNumber, headSha, feedback);
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
            body: (0, inline_comment_1.inlineCommentBody)(f, { at }),
        }));
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                commit_id: headSha,
                body: (0, summary_comment_1.buildSummaryBody)(feedback, { posted: comments.length, headSha }),
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
            body: JSON.stringify({ body: (0, summary_comment_1.buildSummaryBody)(feedback, { posted: 0, headSha }) }),
        });
        if (fallback.ok)
            return;
        throw new Error(explainPostFailure(fallback.status, (await githubErrorMessage(fallback)) || reviewError));
    }
    async postCommitStatus(token, owner, repo, sha, feedback) {
        return this.postStatuses(token, owner, repo, sha, commitStatusFor(feedback));
    }
    async postStatuses(token, owner, repo, sha, status) {
        return Promise.all([check_run_1.CHECK_NAME, 'audit/bench'].map((context) => fetch(`${GITHUB_API}/repos/${owner}/${repo}/statuses/${sha}`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...status, context }),
        })));
    }
    async canPushTo(userId, owner, repo) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        if (!user.githubToken)
            return false;
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
            headers: this.authHeaders(this.tokenCrypto.decrypt(user.githubToken)),
        });
        if (!res.ok)
            return false;
        const body = (await res.json());
        return Boolean(body.permissions?.push || body.permissions?.maintain || body.permissions?.admin);
    }
    async createReviewComment(auth, owner, repo, pullNumber, opts) {
        const token = await this.requireToken(auth);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/comments`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                body: opts.body,
                commit_id: opts.commitId,
                path: opts.path,
                line: opts.end,
                side: 'RIGHT',
                ...(opts.end > opts.start ? { start_line: opts.start, start_side: 'RIGHT' } : {}),
            }),
        });
        if (!res.ok)
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
        const data = (await res.json());
        return { id: data.id, htmlUrl: data.html_url };
    }
    async getReviewComment(auth, owner, repo, commentId) {
        const token = await this.requireToken(auth);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/comments/${commentId}`, {
            headers: this.authHeaders(token),
        });
        if (!res.ok)
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
        return (await res.json());
    }
    async listPullReviewComments(auth, owner, repo, pullNumber) {
        const token = await this.requireToken(auth);
        const all = [];
        for (let page = 1; page <= 5; page++) {
            const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/comments?per_page=100&page=${page}`, { headers: this.authHeaders(token) });
            if (!res.ok)
                throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
            const batch = (await res.json());
            all.push(...batch);
            if (batch.length < 100)
                break;
        }
        return all;
    }
    async reviewThreadStates(auth, owner, repo, pullNumber) {
        const token = await this.requireToken(auth);
        const res = await fetch(`${GITHUB_API}/graphql`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: `query($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
            reviewThreads(first: 100) { nodes { isResolved isOutdated comments(first: 1) { nodes { databaseId } } } }
          } } }`,
                variables: { owner, repo, number: pullNumber },
            }),
        });
        const states = new Map();
        if (!res.ok)
            return states;
        const body = (await res.json());
        for (const t of body.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []) {
            const id = t.comments?.nodes?.[0]?.databaseId;
            if (id)
                states.set(id, { resolved: Boolean(t.isResolved), outdated: Boolean(t.isOutdated) });
        }
        return states;
    }
    async listReviewThread(auth, owner, repo, pullNumber, rootId) {
        const token = await this.requireToken(auth);
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
    async replyToReviewComment(auth, owner, repo, pullNumber, rootId, body) {
        const token = await this.requireToken(auth);
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/comments/${rootId}/replies`, {
            method: 'POST',
            headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
        });
        if (!res.ok)
            throw (0, git_host_errors_1.gitHostRequestFailed)('GitHub', res.status);
    }
    async resolveReviewThread(auth, owner, repo, pullNumber, rootId) {
        const token = await this.requireToken(auth);
        const graphql = async (query, variables) => {
            const res = await fetch(`${GITHUB_API}/graphql`, {
                method: 'POST',
                headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, variables }),
            });
            return res.ok ? (await res.json()) : { errors: [res.status] };
        };
        const found = await graphql(`
        query ($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              reviewThreads(first: 100) {
                nodes {
                  id
                  isResolved
                  comments(first: 1) {
                    nodes {
                      databaseId
                    }
                  }
                }
              }
            }
          }
        }
      `, { owner, repo, number: pullNumber });
        const threads = found.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
        const thread = threads.find((t) => t.comments.nodes[0]?.databaseId === rootId);
        if (!thread)
            return false;
        if (thread.isResolved)
            return true;
        const done = await graphql(`
        mutation ($id: ID!) {
          resolveReviewThread(input: { threadId: $id }) {
            thread {
              isResolved
            }
          }
        }
      `, { id: thread.id });
        return Boolean(done.data?.resolveReviewThread?.thread?.isResolved);
    }
    async postIssueComment(auth, owner, repo, issueNumber, body) {
        const token = await this.requireToken(auth);
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
exports.GithubService = GithubService = GithubService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        pr_feedback_service_1.PrFeedbackService,
        token_crypto_service_1.TokenCryptoService,
        github_app_auth_service_1.GithubAppAuthService])
], GithubService);
function mapGithubContributorStats(raw) {
    return raw
        .filter((entry) => Boolean(entry) && typeof entry.total === 'number')
        .map((entry) => {
        const weeks = Array.isArray(entry.weeks)
            ? entry.weeks
            : [];
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
    if (/not accessible by integration/i.test(message)) {
        return `${base} The Audit Bench Ai GitHub App is missing a permission on this repository. In the app's settings set Pull requests and Checks to "Read and write", then accept the new permissions on the installation (GitHub → Settings → Applications → Audit Bench Ai → Review request).`;
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
function commitStatusFor(feedback) {
    if ((0, check_run_1.checkConclusion)(feedback) === 'failure') {
        return { state: 'failure', description: 'Audit Bench Ai found blocking issues — see review comments' };
    }
    if (feedback.verdict === 'needs_work') {
        return { state: 'success', description: 'Audit Bench Ai found issues worth reviewing' };
    }
    return { state: 'success', description: 'Audit Bench Ai found no issues' };
}
//# sourceMappingURL=github.service.js.map