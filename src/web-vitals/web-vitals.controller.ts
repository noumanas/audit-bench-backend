import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { WebVitalsService } from './web-vitals.service';
import { RecordWebVitalDto } from './dto/record-web-vital.dto';

@Controller('web-vitals')
export class WebVitalsController {
  constructor(private readonly webVitals: WebVitalsService) {}

  /**
   * Public and unauthenticated on purpose — most of what reports here is
   * logged-out marketing-site traffic, so there's no session to require.
   * Protected the same way every other route is: the app-wide ThrottlerGuard
   * (see AppModule). No PII, no user association — see WebVital in schema.prisma.
   */
  @Post()
  @HttpCode(204)
  async record(@Body() dto: RecordWebVitalDto): Promise<void> {
    await this.webVitals.record(dto);
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  getSummary(@Query('days') days?: string) {
    return this.webVitals.getSummary(days ? Number(days) : undefined);
  }
}
