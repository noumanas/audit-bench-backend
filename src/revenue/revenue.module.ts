import { Module } from '@nestjs/common';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { SubscriptionService } from './subscription.service';

// Depends only on Prisma, so the plan-changing modules (admin, users, quota)
// can import it to record subscription terms without a circular import.
@Module({
  controllers: [RevenueController],
  providers: [RevenueService, SubscriptionService],
  exports: [SubscriptionService],
})
export class RevenueModule {}
