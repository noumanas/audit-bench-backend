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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubController = void 0;
const common_1 = require("@nestjs/common");
const github_service_1 = require("./github.service");
const repository_service_1 = require("../repository/repository.service");
const connect_github_dto_1 = require("./dto/connect-github.dto");
const scan_repo_dto_1 = require("./dto/scan-repo.dto");
const review_pr_dto_1 = require("./dto/review-pr.dto");
const review_pr_url_dto_1 = require("./dto/review-pr-url.dto");
const github_url_1 = require("../common/github-url");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const current_user_decorator_1 = require("../auth/current-user.decorator");
let GithubController = class GithubController {
    githubService;
    repositoryService;
    constructor(githubService, repositoryService) {
        this.githubService = githubService;
        this.repositoryService = repositoryService;
    }
    status(user) {
        return this.githubService.status(user.id);
    }
    connect(user, dto) {
        return this.githubService.connect(user.id, dto.token);
    }
    disconnect(user) {
        return this.githubService.disconnect(user.id);
    }
    listRepos(user) {
        return this.githubService.listReposFor(user.id);
    }
    async listBranches(user, owner, repo) {
        return this.githubService.listBranches(await this.githubService.authFor(user.id, owner), owner, repo);
    }
    async listPullRequests(user, owner, repo) {
        return this.githubService.listPullRequests(await this.githubService.authFor(user.id, owner), owner, repo);
    }
    async scan(user, dto) {
        const auth = await this.githubService.authFor(user.id, dto.owner);
        const { defaultBranch } = await this.githubService.getRepoMeta(auth, dto.owner, dto.repo);
        const ref = dto.ref || defaultBranch;
        const [zipBuffer, contributorStats] = await Promise.all([
            this.githubService.downloadRepoZip(auth, dto.owner, dto.repo, ref),
            this.githubService.fetchContributorStats(auth, dto.owner, dto.repo),
        ]);
        return this.repositoryService.createScanJobFromBuffer(user, zipBuffer, `${dto.owner}/${dto.repo}`, dto.provider, 'github_repo', { kind: 'github', owner: dto.owner, repo: dto.repo, ref, defaultBranch }, contributorStats);
    }
    async reviewPr(user, dto) {
        const auth = await this.githubService.authFor(user.id, dto.owner);
        const { files, url, headSha, headRef, baseRef, snapshot, repoFiles } = await this.githubService.fetchPrFiles(auth, dto.owner, dto.repo, dto.pullNumber, { withSnapshot: true, withRepoContext: true });
        return this.repositoryService.createDiffReview(user, files, {
            sourceName: `${dto.owner}/${dto.repo}#${dto.pullNumber}`,
            sourceType: 'github_pr',
            pullRequestUrl: url,
            provider: dto.provider,
            prContext: {
                kind: 'github',
                owner: dto.owner,
                repo: dto.repo,
                pullNumber: dto.pullNumber,
                headSha,
                headRef,
                baseRef,
                ...(typeof auth === 'string' ? {} : { installationId: auth.installationId }),
            },
        }, { prSnapshot: snapshot, repoFiles });
    }
    async reviewPrByUrl(user, dto) {
        const parsed = (0, github_url_1.parseGithubPrUrl)(dto.prUrl);
        if (!parsed) {
            throw new common_1.BadRequestException('Paste a GitHub pull request link, like https://github.com/owner/repo/pull/123');
        }
        const { owner, repo, number } = parsed;
        const auth = await this.githubService.authFor(user.id, owner);
        const { files, url, headSha, headRef, baseRef, snapshot, repoFiles } = await this.githubService.fetchPrFiles(auth, owner, repo, number, { withSnapshot: true, withRepoContext: true });
        if (dto.postToGithub && snapshot && snapshot.state !== 'open') {
            throw new common_1.BadRequestException(`${owner}/${repo}#${number} is already ${snapshot.merged ? 'merged' : 'closed'}, so a review comment wouldn't help. Turn off "Post on GitHub" to review it in the app.`);
        }
        return this.repositoryService.createDiffReview(user, files, {
            sourceName: `${owner}/${repo}#${number}`,
            sourceType: 'github_pr',
            pullRequestUrl: url,
            provider: dto.provider,
            prContext: dto.postToGithub
                ? {
                    kind: 'github',
                    owner,
                    repo,
                    pullNumber: number,
                    headSha,
                    headRef,
                    baseRef,
                    ...(typeof auth === 'string' ? {} : { installationId: auth.installationId }),
                }
                : undefined,
        }, { prSnapshot: snapshot, repoFiles });
    }
};
exports.GithubController = GithubController;
__decorate([
    (0, common_1.Get)('status'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GithubController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('connect'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, connect_github_dto_1.ConnectGithubDto]),
    __metadata("design:returntype", void 0)
], GithubController.prototype, "connect", null);
__decorate([
    (0, common_1.Delete)('disconnect'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GithubController.prototype, "disconnect", null);
__decorate([
    (0, common_1.Get)('repos'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GithubController.prototype, "listRepos", null);
__decorate([
    (0, common_1.Get)('repos/:owner/:repo/branches'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('owner')),
    __param(2, (0, common_1.Param)('repo')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], GithubController.prototype, "listBranches", null);
__decorate([
    (0, common_1.Get)('repos/:owner/:repo/pulls'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('owner')),
    __param(2, (0, common_1.Param)('repo')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], GithubController.prototype, "listPullRequests", null);
__decorate([
    (0, common_1.Post)('scan'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, scan_repo_dto_1.ScanRepoDto]),
    __metadata("design:returntype", Promise)
], GithubController.prototype, "scan", null);
__decorate([
    (0, common_1.Post)('pr'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, review_pr_dto_1.ReviewPrDto]),
    __metadata("design:returntype", Promise)
], GithubController.prototype, "reviewPr", null);
__decorate([
    (0, common_1.Post)('pr-url'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, review_pr_url_dto_1.ReviewPrUrlDto]),
    __metadata("design:returntype", Promise)
], GithubController.prototype, "reviewPrByUrl", null);
exports.GithubController = GithubController = __decorate([
    (0, common_1.Controller)('github'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [github_service_1.GithubService,
        repository_service_1.RepositoryService])
], GithubController);
//# sourceMappingURL=github.controller.js.map