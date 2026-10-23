import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import * as crypto from "crypto";
import { ConnectProvider, OAuthService } from "./oauth.service";
import { OAuthProvider } from "./oauth.types";
import { ExchangeOAuthDto } from "./dto/exchange-oauth.dto";
import { CompleteConnectDto } from "./dto/complete-connect.dto";
import { JwtAuthGuard } from "../jwt-auth.guard";
import { CurrentUser } from "../current-user.decorator";
import { RequestUser } from "../types";
import { AuthService } from "../auth.service";

const STATE_COOKIE = "oauth_state";
const CONNECT_PROVIDERS = new Set<string>(["github", "gitlab"]);

function connectProvider(value: string): ConnectProvider {
  if (!CONNECT_PROVIDERS.has(value)) {
    throw new BadRequestException(
      "Only GitHub and GitLab can be connected this way.",
    );
  }
  return value as ConnectProvider;
}

@Controller("auth")
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Get("github")
  githubAuthorize(@Req() req: Request, @Res() res: Response) {
    this.redirectToProvider("github", req, res);
  }

  @Get("gitlab")
  gitlabAuthorize(@Req() req: Request, @Res() res: Response) {
    this.redirectToProvider("gitlab", req, res);
  }

  @Get("google")
  googleAuthorize(@Req() req: Request, @Res() res: Response) {
    this.redirectToProvider("google", req, res);
  }

  @Get("github/callback")
  githubCallback(
    @Req() req: Request,
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: Response,
  ) {
    return this.handleCallback("github", req, code, state, res);
  }

  @Get("gitlab/callback")
  gitlabCallback(
    @Req() req: Request,
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: Response,
  ) {
    return this.handleCallback("gitlab", req, code, state, res);
  }

  @Get("google/callback")
  googleCallback(
    @Req() req: Request,
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: Response,
  ) {
    return this.handleCallback("google", req, code, state, res);
  }

  /** The frontend calls this with the one-time code from the redirect to get a real session — see OAuthService. */
  @Post("oauth/exchange")
  async exchange(@Body() dto: ExchangeOAuthDto) {
    const user = await this.oauthService.exchangeLoginCode(dto.code);
    return this.authService.buildSession(user);
  }

  /**
   * "Connect GitHub/GitLab" for a signed-in user: the provider's consent
   * page to send the browser to. No cookie: the signed state is checked
   * against the signed-in user when the frontend completes the connection.
   */
  @Post(":provider/connect")
  @UseGuards(JwtAuthGuard)
  connectUrl(
    @CurrentUser() user: RequestUser,
    @Param("provider") provider: string,
  ) {
    return {
      url: this.oauthService.connectUrl(connectProvider(provider), user.id),
    };
  }

  @Post("connect/complete")
  @UseGuards(JwtAuthGuard)
  completeConnect(
    @CurrentUser() user: RequestUser,
    @Body() dto: CompleteConnectDto,
  ) {
    return this.oauthService.connectAccount(
      user.id,
      connectProvider(dto.provider),
      dto.code,
      dto.state,
    );
  }

  private redirectToProvider(
    provider: OAuthProvider,
    req: Request,
    res: Response,
  ) {
    // The state cookie only comes back if the provider returns the browser
    // to the same host that set it. If sign-in started on another address
    // for this API (say the Cloud Run URL, while BACKEND_ORIGIN — the
    // registered callback — is api.auditbenchai.com), hop to the callback's
    // host first; otherwise every login fails as "interrupted or expired".
    const callbackHost = new URL(this.oauthService.redirectUri(provider)).host;
    const requestHost = req.get("host");
    if (requestHost && requestHost !== callbackHost) {
      res.redirect(
        new URL(`/auth/${provider}`, this.oauthService.redirectUri(provider))
          .href,
      );
      return;
    }

    // CSRF guard for the callback: a random value round-tripped through the
    // provider's redirect must match what we stashed in an httpOnly cookie
    // before sending the browser away.
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 5 * 60_000,
      sameSite: "lax",
    });
    res.redirect(this.oauthService.getAuthorizeUrl(provider, state));
  }

  private async handleCallback(
    provider: OAuthProvider,
    req: Request,
    code: string,
    state: string,
    res: Response,
  ) {
    const frontendOrigin = (
      this.config.get<string>("FRONTEND_ORIGIN") || "http://localhost:3000"
    )
      .split(",")[0]
      .trim();
    // A signed-in user connecting their repositories, not a sign-in: hand the
    // code to the frontend, which finishes it with the user's session.
    if (provider !== "google" && this.oauthService.isConnectState(state)) {
      const params = new URLSearchParams({ provider, code: code ?? "", state });
      res.redirect(`${frontendOrigin}/oauth/connect?${params}`);
      return;
    }

    const cookieState = (req as unknown as { cookies?: Record<string, string> })
      .cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE);

    if (!code || !state || !cookieState || state !== cookieState) {
      res.redirect(
        `${frontendOrigin}/oauth/callback?error=${encodeURIComponent("Login was interrupted or expired — please try again.")}`,
      );
      return;
    }

    try {
      const loginCode = await this.oauthService.handleCallback(provider, code);
      res.redirect(`${frontendOrigin}/oauth/callback?code=${loginCode}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed.";
      res.redirect(
        `${frontendOrigin}/oauth/callback?error=${encodeURIComponent(message)}`,
      );
    }
  }
}
