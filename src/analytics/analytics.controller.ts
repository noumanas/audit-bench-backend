import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';

function parseWindowDays(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(180, Math.max(1, parsed));
}

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  overview(@CurrentUser() user: RequestUser, @Query('days') days?: string) {
    return this.analyticsService.overview(user.id, parseWindowDays(days, 30));
  }

  @Get('trend')
  trend(@CurrentUser() user: RequestUser, @Query('days') days?: string) {
    return this.analyticsService.trend(user.id, parseWindowDays(days, 30));
  }
}
