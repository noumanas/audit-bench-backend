import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { TokenCryptoModule } from './common/token-crypto.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PlansModule } from './plans/plans.module';
import { QuotaModule } from './quota/quota.module';
import { AuditModule } from './audit/audit.module';
import { RepositoryModule } from './repository/repository.module';
import { ReportModule } from './report/report.module';
import { GithubModule } from './github/github.module';
import { GitlabModule } from './gitlab/gitlab.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminModule } from './admin/admin.module';
import { BadgeModule } from './badge/badge.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { FixModule } from './fix/fix.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Baseline abuse guard for every route — generous enough not to bother
    // normal usage; auth.controller.ts tightens login/signup specifically.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    TokenCryptoModule,
    AuthModule,
    UsersModule,
    PlansModule,
    QuotaModule,
    AuditModule,
    RepositoryModule,
    ReportModule,
    GithubModule,
    GitlabModule,
    AnalyticsModule,
    AdminModule,
    BadgeModule,
    WebhooksModule,
    FixModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
