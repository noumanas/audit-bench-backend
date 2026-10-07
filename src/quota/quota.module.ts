import { RevenueModule } from '../revenue/revenue.module';
import { Module } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { PlanExpiryService } from './plan-expiry.service';

@Module({
  imports: [RevenueModule],
  providers: [QuotaService, PlanExpiryService],
  exports: [QuotaService],
})
export class QuotaModule {}
