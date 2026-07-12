"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const config_1 = require("@nestjs/config");
const throttler_1 = require("@nestjs/throttler");
const schedule_1 = require("@nestjs/schedule");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const prisma_module_1 = require("./prisma/prisma.module");
const token_crypto_module_1 = require("./common/token-crypto.module");
const auth_module_1 = require("./auth/auth.module");
const users_module_1 = require("./users/users.module");
const plans_module_1 = require("./plans/plans.module");
const quota_module_1 = require("./quota/quota.module");
const audit_module_1 = require("./audit/audit.module");
const repository_module_1 = require("./repository/repository.module");
const report_module_1 = require("./report/report.module");
const github_module_1 = require("./github/github.module");
const gitlab_module_1 = require("./gitlab/gitlab.module");
const analytics_module_1 = require("./analytics/analytics.module");
const admin_module_1 = require("./admin/admin.module");
const badge_module_1 = require("./badge/badge.module");
const webhooks_module_1 = require("./webhooks/webhooks.module");
const fix_module_1 = require("./fix/fix.module");
const email_module_1 = require("./email/email.module");
const organization_module_1 = require("./organization/organization.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            throttler_1.ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
            schedule_1.ScheduleModule.forRoot(),
            prisma_module_1.PrismaModule,
            token_crypto_module_1.TokenCryptoModule,
            email_module_1.EmailModule,
            organization_module_1.OrganizationModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            plans_module_1.PlansModule,
            quota_module_1.QuotaModule,
            audit_module_1.AuditModule,
            repository_module_1.RepositoryModule,
            report_module_1.ReportModule,
            github_module_1.GithubModule,
            gitlab_module_1.GitlabModule,
            analytics_module_1.AnalyticsModule,
            admin_module_1.AdminModule,
            badge_module_1.BadgeModule,
            webhooks_module_1.WebhooksModule,
            fix_module_1.FixModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [app_service_1.AppService, { provide: core_1.APP_GUARD, useClass: throttler_1.ThrottlerGuard }],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map