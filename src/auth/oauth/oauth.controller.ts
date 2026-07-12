import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { OAuthService } from './oauth.service';
import { OAuthProvider } from './oauth.types';
import { ExchangeOAuthDto } from './dto/exchange-oauth.dto';
import { AuthService } from '../auth.service';

const STATE_COOKIE = 'oauth_state';

@Controller('auth')
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Get('github')
  githubAuthorize(@Res() res: Response) {
    this.redirectToProvider('github', res);
  }

  @Get('gitlab')
  gitlabAuthorize(@Res() res: Response) {
    this.redirectToProvider('gitlab', res);
  }

  @Get('github/callback')
  githubCallback(@Req() req: Request, @Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    return this.handleCallback('github', req, code, state, res);
  }

  @Get('gitlab/callback')
  gitlabCallback(@Req() req: Request, @Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    return this.handleCallback('gitlab', req, code, state, res);
  }

  /** The frontend calls this with the one-time code from the redirect to get a real session — see OAuthService. */
  @Post('oauth/exchange')
  async exchange(@Body() dto: ExchangeOAuthDto) {
    const user = await this.oauthService.exchangeLoginCode(dto.code);
    return this.authService.buildSession(user);
  }

  private redirectToProvider(provider: OAuthProvider, res: Response) {
    // CSRF guard for the callback: a random value round-tripped through the
    // provider's redirect must match what we stashed in an httpOnly cookie
    // before sending the browser away.
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, state, { httpOnly: true, maxAge: 5 * 60_000, sameSite: 'lax' });
    res.redirect(this.oauthService.getAuthorizeUrl(provider, state));
  }

  private async handleCallback(provider: OAuthProvider, req: Request, code: string, state: string, res: Response) {
    const frontendOrigin = (this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:3000')
      .split(',')[0]
      .trim();
    const cookieState = (req as unknown as { cookies?: Record<string, string> }).cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE);

    if (!code || !state || !cookieState || state !== cookieState) {
      res.redirect(
        `${frontendOrigin}/oauth/callback?error=${encodeURIComponent('Login was interrupted or expired — please try again.')}`,
      );
      return;
    }

    try {
      const loginCode = await this.oauthService.handleCallback(provider, code);
      res.redirect(`${frontendOrigin}/oauth/callback?code=${loginCode}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed.';
      res.redirect(`${frontendOrigin}/oauth/callback?error=${encodeURIComponent(message)}`);
    }
  }
}
