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
exports.ReportController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const workspace_scope_1 = require("../common/workspace-scope");
let ReportController = class ReportController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findOne(user, id) {
        const audit = await this.prisma.audit.findUnique({ where: { id } });
        if (audit && (0, workspace_scope_1.canViewResource)(user, audit))
            return { kind: 'audit', ...audit };
        const scan = await this.prisma.scanJob.findUnique({ where: { id }, include: { files: true } });
        if (scan && (0, workspace_scope_1.canViewResource)(user, scan))
            return { kind: 'repository', ...scan };
        throw new common_1.NotFoundException(`Report ${id} not found`);
    }
};
exports.ReportController = ReportController;
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ReportController.prototype, "findOne", null);
exports.ReportController = ReportController = __decorate([
    (0, common_1.Controller)('report'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReportController);
//# sourceMappingURL=report.controller.js.map