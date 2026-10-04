import { Module } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { PlanExpiryService } from './plan-expiry.service';

@Module({
  providers: [QuotaService, PlanExpiryService],
  exports: [QuotaService],
})
export class QuotaModule {}
