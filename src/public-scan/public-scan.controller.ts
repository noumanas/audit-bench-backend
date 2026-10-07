import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { PublicScanService } from './public-scan.service';
import { StartPublicScanDto } from './dto/start-public-scan.dto';

/** No sign-in needed: free scans of public GitHub repos, and shared reports. */
@Controller('public')
export class PublicScanController {
  constructor(private readonly publicScans: PublicScanService) {}

  // A cheap first line of defence; PublicScanService also enforces per-visitor
  // and site-wide caps from the database, which survive restarts.
  @Post('scans')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  start(@Body() dto: StartPublicScanDto, @Req() req: Request) {
    return this.publicScans.startScan(dto.repoUrl, req.ip ?? 'unknown');
  }

  @Get('scans/:shareId')
  get(@Param('shareId') shareId: string) {
    return this.publicScans.getShared(shareId);
  }
}

/** Owners (and their team) turning a public link on or off for one of their scans. */
@Controller('repository')
@UseGuards(JwtAuthGuard)
export class ScanShareController {
  constructor(private readonly publicScans: PublicScanService) {}

  @Post(':id/share')
  share(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.publicScans.share(user, id);
  }

  @Delete(':id/share')
  unshare(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.publicScans.unshare(user, id);
  }
}
