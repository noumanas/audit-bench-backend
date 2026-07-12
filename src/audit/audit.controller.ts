import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateAuditDto) {
    return this.auditService.runAudit(user, dto);
  }

  @Get()
  findRecent(@CurrentUser() user: RequestUser, @Query('limit') limit?: string) {
    return this.auditService.findRecent(user, limit ? Number(limit) : undefined);
  }

  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.auditService.findOne(user, id);
  }
}
