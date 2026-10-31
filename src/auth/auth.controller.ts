import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ActivityService } from '../activity/activity.service';

// Tighter than the app-wide default — these are exactly the routes a
// credential-stuffing / signup-spam attempt would hammer.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
/** Per IP: a person needs one signup, maybe a retry; scripts creating accounts in bulk hit this fast. */
const SIGNUP_THROTTLE = { default: { limit: 5, ttl: 60 * 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly activity: ActivityService,
  ) {}

  @Throttle(SIGNUP_THROTTLE)
  @Post('signup')
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.authService.signup(dto, this.activity.context(req));
  }

  @Throttle(AUTH_THROTTLE)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, this.activity.context(req));
  }
}
