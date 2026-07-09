import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { UsersService } from './users.service';
import { QuotaService } from '../quota/quota.service';
import { ChangePlanDto } from './dto/change-plan.dto';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly quotaService: QuotaService,
  ) {}

  @Get()
  getProfile(@CurrentUser() user: RequestUser) {
    return this.usersService.getProfile(user.id);
  }

  @Get('usage')
  getUsage(@CurrentUser() user: RequestUser) {
    return this.quotaService.getUsage(user.id);
  }

  @Post('plan')
  changePlan(@CurrentUser() user: RequestUser, @Body() dto: ChangePlanDto) {
    // Self-service plan switch for demo purposes — a real billing flow
    // (Stripe checkout/webhooks) would gate this instead of a bare POST.
    return this.usersService.changePlan(user.id, dto.slug);
  }
}
