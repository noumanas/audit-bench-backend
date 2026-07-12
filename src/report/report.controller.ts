import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { canViewResource } from '../common/workspace-scope';

/**
 * A report ID can belong to either an Audit (single-file review) or a
 * ScanJob (repository review) — this endpoint checks both so clients don't
 * need to know which kind produced a given ID.
 */
@Controller('report')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const audit = await this.prisma.audit.findUnique({ where: { id } });
    if (audit && canViewResource(user, audit)) return { kind: 'audit', ...audit };

    const scan = await this.prisma.scanJob.findUnique({ where: { id }, include: { files: true } });
    if (scan && canViewResource(user, scan)) return { kind: 'repository', ...scan };

    throw new NotFoundException(`Report ${id} not found`);
  }
}
