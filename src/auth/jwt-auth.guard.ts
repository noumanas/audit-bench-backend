import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { API_KEY_PREFIX } from './api-key.util';
import { RequestUser } from './types';

/**
 * Accepts either a real JWT (browser sessions, passport-jwt as before) or a
 * long-lived API key (CLI/CI — see api-key.util.ts) on the same
 * `Authorization: Bearer <token>` header. The prefix tells them apart
 * up front, since passport-jwt would otherwise just fail trying to verify
 * an API key's signature as if it were a JWT.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (token?.startsWith(API_KEY_PREFIX)) {
      const user = await this.prisma.user.findUnique({ where: { apiKey: token } });
      if (!user) throw new UnauthorizedException('Invalid API key');
      if (!user.isActive) throw new UnauthorizedException('This account has been suspended.');

      const requestUser: RequestUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      };
      (request as Request & { user: RequestUser }).user = requestUser;
      return true;
    }

    return super.canActivate(context) as Promise<boolean>;
  }
}
