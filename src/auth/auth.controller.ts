import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto, VerifyResetCodeDto } from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset.service';
import { ActivityService } from '../activity/activity.service';

// Tighter than the app-wide default — these are exactly the routes a
// credential-stuffing / signup-spam attempt would hammer.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
/** Per IP: a person needs one signup, maybe a retry; scripts creating accounts in bulk hit this fast. */
const SIGNUP_THROTTLE = { default: { limit: 5, ttl: 60 * 60_000 } };
/** Per IP: each code request sends an email, so keep it to a handful an hour. */
const RESET_REQUEST_THROTTLE = { default: { limit: 5, ttl: 60 * 60_000 } };
/** Per IP, on top of the per-account guess limit in PasswordResetService. */
const RESET_VERIFY_THROTTLE = { default: { limit: 10, ttl: 10 * 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
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

  /** Step 1: email a reset code. Always answers { ok: true }, account or not. */
  @Throttle(RESET_REQUEST_THROTTLE)
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordReset.requestCode(dto.email);
  }

  /** Step 2: the code from the email, traded for a short-lived reset token. */
  @Throttle(RESET_VERIFY_THROTTLE)
  @Post('forgot-password/verify')
  @HttpCode(200)
  verifyResetCode(@Body() dto: VerifyResetCodeDto) {
    return this.passwordReset.verifyCode(dto.email, dto.code);
  }

  /** Step 3: set the new password; signs the user in and every other session out. */
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.passwordReset.resetPassword(dto.email, dto.resetToken, dto.password, this.activity.context(req));
  }
}
