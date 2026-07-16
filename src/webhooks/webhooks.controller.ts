import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { CreateWebhookConfigDto } from './dto/create-webhook-config.dto';
import { UpdateWebhookConfigDto } from './dto/update-webhook-config.dto';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @UseGuards(JwtAuthGuard)
  @Get('configs')
  listConfigs(@CurrentUser() user: RequestUser) {
    return this.webhooksService.listConfigs(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('configs')
  createConfig(@CurrentUser() user: RequestUser, @Body() dto: CreateWebhookConfigDto) {
    return this.webhooksService.createConfig(user.id, dto.provider, dto.repoIdentifier, dto.autoReview);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('configs/:id')
  updateConfig(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateWebhookConfigDto) {
    return this.webhooksService.updateConfig(user.id, id, dto.autoReview);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('configs/:id')
  deleteConfig(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.webhooksService.deleteConfig(user.id, id);
  }

  // Public receivers, manually configured by the user in their repo/project's
  // webhook settings — verified via signature/token below, not JWT.
  @Post('github')
  handleGithub(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    return this.webhooksService.handleGithubEvent(event, req.rawBody ?? Buffer.alloc(0), req.body, signature);
  }

  @Post('gitlab')
  handleGitlab(@Req() req: Request, @Headers('x-gitlab-event') event: string, @Headers('x-gitlab-token') token: string) {
    return this.webhooksService.handleGitlabEvent(event, req.body, token);
  }
}
