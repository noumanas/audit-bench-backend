import { RevenueModule } from '../revenue/revenue.module';
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminUsageService } from './admin-usage.service';
import { QuotaModule } from '../quota/quota.module';
import { ReviewRulesModule } from '../review-rules/review-rules.module';

@Module({
  imports: [RevenueModule, QuotaModule, ReviewRulesModule],
  controllers: [AdminController],
  providers: [AdminService, AdminUsageService],
})
export class AdminModule {}
