import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { RevenueService } from './revenue.service';
import { CancelSubscriptionDto, RecordPaymentDto, UpdateSubscriptionDto } from './dto/revenue.dto';

/** MRR/ARR reporting and revenue management — super admin only. */
@Controller('admin/revenue')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class RevenueController {
  constructor(private readonly revenue: RevenueService) {}

  @Get('overview')
  overview(@Query('months') months?: string) {
    const n = Math.min(24, Math.max(3, Number(months) || 12));
    return this.revenue.overview(n);
  }

  @Get('subscriptions')
  subscriptions(@Query('status') status?: string) {
    return this.revenue.listSubscriptions(status);
  }

  @Patch('subscriptions/:id')
  updateSubscription(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.revenue.updateSubscription(id, dto);
  }

  @Post('subscriptions/:id/renew')
  renew(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.revenue.renew(id, user.id);
  }

  @Post('subscriptions/:id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelSubscriptionDto) {
    return this.revenue.cancel(id, Boolean(dto.downgrade));
  }

  @Get('payments')
  payments() {
    return this.revenue.listPayments();
  }

  @Post('payments')
  recordPayment(@CurrentUser() user: RequestUser, @Body() dto: RecordPaymentDto) {
    return this.revenue.recordPayment(user.id, dto);
  }

  @Delete('payments/:id')
  deletePayment(@Param('id') id: string) {
    return this.revenue.deletePayment(id);
  }
}
