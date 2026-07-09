import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
