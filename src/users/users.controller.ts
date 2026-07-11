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
    // Free applies instantly; anything else files a PlanRequest for an
    // admin/super_admin to approve — see UsersService.changePlan.
    return this.usersService.changePlan(user.id, dto.slug);
  }

  @Get('plan-requests')
  listMyPlanRequests(@CurrentUser() user: RequestUser) {
    return this.usersService.listMyPlanRequests(user.id);
  }

  @Get('badge-token')
  async getBadgeToken(@CurrentUser() user: RequestUser) {
    return { badgeToken: await this.usersService.getBadgeToken(user.id) };
  }

  @Post('badge-token/rotate')
  async rotateBadgeToken(@CurrentUser() user: RequestUser) {
    return { badgeToken: await this.usersService.rotateBadgeToken(user.id) };
  }
}
