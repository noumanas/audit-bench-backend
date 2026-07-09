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
exports.GitlabController = void 0;
const common_1 = require("@nestjs/common");
const gitlab_service_1 = require("./gitlab.service");
const repository_service_1 = require("../repository/repository.service");
const connect_gitlab_dto_1 = require("./dto/connect-gitlab.dto");
const scan_project_dto_1 = require("./dto/scan-project.dto");
const review_mr_dto_1 = require("./dto/review-mr.dto");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const current_user_decorator_1 = require("../auth/current-user.decorator");
let GitlabController = class GitlabController {
    gitlabService;
    repositoryService;
    constructor(gitlabService, repositoryService) {
        this.gitlabService = gitlabService;
        this.repositoryService = repositoryService;
    }
    status(user) {
        return this.gitlabService.status(user.id);
    }
    connect(user, dto) {
        return this.gitlabService.connect(user.id, dto.token);
    }
    disconnect(user) {
        return this.gitlabService.disconnect(user.id);
    }
    listProjects(user) {
        return this.gitlabService.listProjects(user.id);
    }
    async scan(user, dto) {
        const zipBuffer = await this.gitlabService.downloadProjectZip(user.id, dto.projectId, dto.ref);
        return this.repositoryService.createScanJobFromBuffer(user.id, zipBuffer, dto.projectPath || `project ${dto.projectId}`, dto.provider, 'gitlab_repo');
    }
    async reviewMr(user, dto) {
        const { files, url } = await this.gitlabService.fetchMrFiles(user.id, dto.projectId, dto.mrIid);
        return this.repositoryService.createDiffReview(user.id, files, {
            sourceName: `${dto.projectPath || `project ${dto.projectId}`} !${dto.mrIid}`,
            sourceType: 'gitlab_mr',
            pullRequestUrl: url,
            provider: dto.provider,
        });
    }
};
exports.GitlabController = GitlabController;
__decorate([
    (0, common_1.Get)('status'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GitlabController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('connect'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, connect_gitlab_dto_1.ConnectGitlabDto]),
    __metadata("design:returntype", void 0)
], GitlabController.prototype, "connect", null);
__decorate([
    (0, common_1.Delete)('disconnect'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GitlabController.prototype, "disconnect", null);
__decorate([
    (0, common_1.Get)('projects'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GitlabController.prototype, "listProjects", null);
__decorate([
    (0, common_1.Post)('scan'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, scan_project_dto_1.ScanProjectDto]),
    __metadata("design:returntype", Promise)
], GitlabController.prototype, "scan", null);
__decorate([
    (0, common_1.Post)('mr'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, review_mr_dto_1.ReviewMrDto]),
    __metadata("design:returntype", Promise)
], GitlabController.prototype, "reviewMr", null);
exports.GitlabController = GitlabController = __decorate([
    (0, common_1.Controller)('gitlab'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [gitlab_service_1.GitlabService,
        repository_service_1.RepositoryService])
], GitlabController);
//# sourceMappingURL=gitlab.controller.js.map