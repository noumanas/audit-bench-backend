import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { GithubAppService } from './github-app.service';
import { UpdateInstallationDto } from './dto/update-installation.dto';

@Controller('github-app')
export class GithubAppController {
  constructor(private readonly app: GithubAppService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: RequestUser) {
    return this.app.status(user.id);
  }

  @Get('install-url')
  @UseGuards(JwtAuthGuard)
  installUrl(@CurrentUser() user: RequestUser) {
    return this.app.installUrl(user.id);
  }

  /** GitHub's Setup URL: the browser lands here after installing or changing the app. */
  @Get('setup')
  async setup(
    @Query('installation_id') installationId: string,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    res.redirect(await this.app.handleSetup(Number(installationId), state));
  }

  @Post('installations/:id/claim')
  @UseGuards(JwtAuthGuard)
  claim(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.app.claim(user.id, id);
  }

  @Patch('installations/:id')
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInstallationDto) {
    return this.app.update(user.id, id, dto.autoReview);
  }

  @Delete('installations/:id')
  @UseGuards(JwtAuthGuard)
  unlink(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.app.unlink(user.id, id);
  }

  /** Super admin: the manifest to create the app on GitHub in one click (optionally under an organization). */
  @Get('manifest')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  manifest(@CurrentUser() user: RequestUser, @Query('org') org?: string) {
    return this.app.manifest(user.id, org);
  }

  @Get('manifest/callback')
  async manifestCallback(@Query('code') code: string, @Query('state') state: string | undefined, @Res() res: Response) {
    res.redirect(await this.app.handleManifestCallback(code, state));
  }
}

/** One webhook for every repository the app is installed on, signed with the app's secret. */
@Controller('webhooks')
export class GithubAppWebhookController {
  constructor(private readonly app: GithubAppService) {}

  @Post('github-app')
  handle(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    return this.app.handleWebhook(event, req.rawBody ?? Buffer.alloc(0), req.body, signature);
  }
}
