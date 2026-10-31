import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { UsersService } from './users.service';
import { QuotaService } from '../quota/quota.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import { ActivityService } from '../activity/activity.service';

class DeleteAccountDto {
  @IsString()
  @MaxLength(320)
  confirmEmail!: string;
}

@Controller('me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly quotaService: QuotaService,
    private readonly activity: ActivityService,
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
  changePlan(@CurrentUser() user: RequestUser, @Body() dto: ChangePlanDto, @Req() req: Request) {
    // Free applies instantly; anything else files a PlanRequest for an
    // admin/super_admin to approve — see UsersService.changePlan.
    return this.usersService.changePlan(user.id, dto.slug, this.activity.context(req));
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

  @Get('api-key')
  async getApiKey(@CurrentUser() user: RequestUser) {
    return { apiKey: await this.usersService.getApiKey(user.id) };
  }

  @Post('api-key/rotate')
  async rotateApiKey(@CurrentUser() user: RequestUser) {
    return { apiKey: await this.usersService.rotateApiKey(user.id) };
  }

  /** Deletes the signed-in account and its data — see UsersService.deleteAccount. */
  @Delete()
  deleteAccount(@CurrentUser() user: RequestUser, @Body() dto: DeleteAccountDto) {
    return this.usersService.deleteAccount(user.id, dto.confirmEmail);
  }
}
