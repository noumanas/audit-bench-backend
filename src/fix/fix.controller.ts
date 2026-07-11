import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { FixService } from './fix.service';
import { CommitFixDto } from './dto/commit-fix.dto';
import { RecheckFixDto } from './dto/recheck-fix.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';

@Controller('repository/:scanJobId/fix')
@UseGuards(JwtAuthGuard)
export class FixController {
  constructor(private readonly fixService: FixService) {}

  @Get('content')
  getFileContent(@CurrentUser() user: RequestUser, @Param('scanJobId') scanJobId: string, @Query('path') path: string) {
    return this.fixService.getFileContent(user.id, scanJobId, path);
  }

  @Post('commit')
  commitFix(@CurrentUser() user: RequestUser, @Param('scanJobId') scanJobId: string, @Body() dto: CommitFixDto) {
    return this.fixService.commitFix(user.id, scanJobId, dto.path, dto.content, dto.message);
  }

  @Post('recheck')
  recheckFix(@CurrentUser() user: RequestUser, @Param('scanJobId') scanJobId: string, @Body() dto: RecheckFixDto) {
    return this.fixService.recheckFix(user.id, scanJobId, dto.path, dto.content);
  }
}
