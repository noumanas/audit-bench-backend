import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { AdminService } from './admin.service';
import { AdminUsageService } from './admin-usage.service';
import { RejectPlanRequestDto } from './dto/reject-plan-request.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ActivityService } from '../activity/activity.service';

class DeleteUserDto {
  @IsString()
  @MaxLength(320)
  confirmEmail!: string;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly usage: AdminUsageService,
    private readonly activity: ActivityService,
  ) {}

  // Sign-ups, sign-ins (and failures) and plan events with IP + location.
  @Get('activity')
  listActivity(
    @Query('type') type?: string,
    @Query('q') q?: string,
    @Query('userId') userId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.activity.list({ type, q, userId, cursor, limit: limit ? Number(limit) || undefined : undefined });
  }

  @Get('activity/summary')
  activitySummary() {
    return this.activity.summary();
  }

  // The admin-panel bell: new sign-ups and plan requests since this admin last looked.
  @Get('notifications')
  notifications(@CurrentUser() user: RequestUser) {
    return this.activity.notifications(user.id);
  }

  @Post('notifications/seen')
  markNotificationsSeen(@CurrentUser() user: RequestUser) {
    return this.activity.markNotificationsSeen(user.id);
  }

  // Each user with their effective plan, quota meters (for the pool they
  // draw from) and this month's own AI usage — see AdminUsageService.
  @Get('users')
  listUsers() {
    return this.usage.listUsersWithUsage();
  }

  @Get('usage/summary')
  usageSummary() {
    return this.usage.summary();
  }

  @Get('users/:id/usage')
  userUsage(@Param('id') id: string) {
    return this.usage.userDetail(id);
  }

  @Post('users/:id/renew-plan')
  renewPlan(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.usage.renewPlan(id, user.id);
  }

  @Get('plan-requests')
  listPlanRequests(@Query('status') status?: string) {
    return this.adminService.listPlanRequests(status);
  }

  @Post('plan-requests/:id/approve')
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.adminService.approvePlanRequest(user.id, id);
  }

  @Post('plan-requests/:id/reject')
  reject(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: RejectPlanRequestDto) {
    return this.adminService.rejectPlanRequest(user.id, id, dto.note);
  }

  // Only super_admin can change roles — overrides the class-level @Roles.
  @Post('users/:id/role')
  @Roles('super_admin')
  updateRole(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.adminService.updateUserRole(user.id, id, dto.role);
  }

  // Suspending an account gates login/access the same way role does, so it
  // gets the same super_admin-only restriction — overrides the class-level @Roles.
  @Post('users/:id/status')
  @Roles('super_admin')
  updateStatus(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.adminService.updateUserStatus(user.id, id, dto.isActive);
  }

  // Permanent and destructive, so super_admin only — overrides the class-level @Roles.
  @Delete('users/:id')
  @Roles('super_admin')
  deleteUser(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: DeleteUserDto) {
    return this.adminService.deleteUser(user.id, id, dto.confirmEmail);
  }

  @Patch('users/:id')
  updateProfile(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.adminService.updateUserProfile(id, dto, user.id);
  }
}
