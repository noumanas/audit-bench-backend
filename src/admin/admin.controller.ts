import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { AdminService } from './admin.service';
import { RejectPlanRequestDto } from './dto/reject-plan-request.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers() {
    return this.adminService.listUsers();
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
}
