import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';

@Controller('organization')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateOrganizationDto) {
    return this.organizationService.create(user.id, dto.name);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  getMine(@CurrentUser() user: RequestUser) {
    return this.organizationService.getForUser(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('invites')
  invite(@CurrentUser() user: RequestUser, @Body() dto: CreateInviteDto) {
    return this.organizationService.createInvite(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('invites/:id')
  revokeInvite(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.organizationService.revokeInvite(user.id, id);
  }

  // Public — the /invite/:token page needs to show who invited you before
  // you're logged in.
  @Get('invites/:token/preview')
  previewInvite(@Param('token') token: string) {
    return this.organizationService.getInvitePreview(token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('invites/:token/accept')
  acceptInvite(@CurrentUser() user: RequestUser, @Param('token') token: string) {
    return this.organizationService.acceptInvite(user.id, token);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('members/:id')
  updateMemberRole(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateMemberRoleDto) {
    return this.organizationService.updateMemberRole(user.id, id, dto.role);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('members/:id')
  removeMember(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.organizationService.removeMember(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('leave')
  leave(@CurrentUser() user: RequestUser) {
    return this.organizationService.leave(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete()
  deleteOrganization(@CurrentUser() user: RequestUser) {
    return this.organizationService.deleteOrganization(user.id);
  }
}
