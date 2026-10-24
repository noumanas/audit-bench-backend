import { BadGatewayException, BadRequestException, Controller, Get, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { UpgradeEmailService } from './upgrade-email.service';
import { INACTIVE_AFTER_DAYS, InactivityEmailService } from './inactivity-email.service';
import { UnsubscribeService } from './unsubscribe.service';
import { escapeHtml } from './templates';

@Controller('email')
export class EmailController {
  constructor(
    private readonly upgradeEmails: UpgradeEmailService,
    private readonly inactivityEmails: InactivityEmailService,
    private readonly unsubscribe: UnsubscribeService,
  ) {}

  // Public — the link in every upgrade/inactivity email. The HMAC token (see
  // UnsubscribeService) is what proves it came from the email, so nobody can
  // unsubscribe someone else by guessing an id.
  // Opened in a browser, so both outcomes are an HTML page, never JSON.
  @Get('unsubscribe')
  async unsubscribePage(@Res() res: Response, @Query('u') userId?: string, @Query('t') token?: string) {
    const ok = await this.tryUnsubscribe(userId, token);
    res.status(ok ? 200 : 400).type('html').send(unsubscribePage(ok));
  }

  // RFC 8058 one-click: mail clients POST here from their own unsubscribe button.
  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribeOneClick(@Query('u') userId?: string, @Query('t') token?: string) {
    await this.unsubscribeOrThrow(userId, token);
    return { unsubscribed: true };
  }

  // ---- Admin Emails tab (super admin): check recipients, preview, send now ----

  @Get('campaigns')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  campaignStatus() {
    return { upgrade: this.upgradeEmails.status(), inactivity: this.inactivityEmails.status() };
  }

  // Dry run by default — lists who'd get it; ?send=true sends in the background.
  @Post('upgrade-campaign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  runCampaign(@Query('send') send?: string) {
    return send === 'true' ? this.upgradeEmails.start() : this.upgradeEmails.run({ dryRun: true });
  }

  @Post('upgrade-campaign/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async preview(@CurrentUser() user: RequestUser) {
    await mailOrBadGateway(this.upgradeEmails.sendTo({ id: user.id, email: user.email, name: null }));
    return { sentTo: user.email };
  }

  @Post('inactivity-campaign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  runInactivity(@Query('send') send?: string) {
    return send === 'true' ? this.inactivityEmails.start() : this.inactivityEmails.run({ dryRun: true });
  }

  @Post('inactivity-campaign/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async previewInactivity(@CurrentUser() user: RequestUser) {
    await mailOrBadGateway(this.inactivityEmails.sendTo({ id: user.id, email: user.email, name: null }, INACTIVE_AFTER_DAYS));
    return { sentTo: user.email };
  }

  private async unsubscribeOrThrow(userId?: string, token?: string) {
    if (!(await this.tryUnsubscribe(userId, token))) throw new BadRequestException('Invalid unsubscribe link');
  }

  private async tryUnsubscribe(userId?: string, token?: string): Promise<boolean> {
    if (!userId || !token || !this.unsubscribe.verify(userId, token)) return false;
    await this.unsubscribe.unsubscribe(userId);
    return true;
  }
}

// The admin sees the mail server's actual reason (e.g. a 421 from Google)
// rather than a bare "Internal server error".
async function mailOrBadGateway(sending: Promise<void>): Promise<void> {
  try {
    await sending;
  } catch (err) {
    throw new BadGatewayException(`The mail server refused the email: ${(err as Error).message.split('\n')[0]}`);
  }
}

function unsubscribePage(ok: boolean): string {
  const title = escapeHtml(ok ? "You're unsubscribed" : 'This link is invalid');
  const message = ok
    ? "You won't get upgrade or reminder emails anymore. Account emails like team invites and plan updates will still reach you."
    : 'This unsubscribe link is incomplete or has been changed. Use the link from the bottom of the most recent email, or reply to it and we will remove you.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f2f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#10141c;">
<div style="max-width:480px;margin:80px auto;padding:36px 32px;background:#fff;border:1px solid #dde0d8;border-radius:12px;">
<h1 style="margin:0 0 12px;font-size:22px;">${title}</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#6b7280;">${escapeHtml(message)}</p>
</div></body></html>`;
}
