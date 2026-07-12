import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { OrgRole, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './types';

// Bumped from 10 → 12 per current OWASP guidance. Existing hashes at the old
// cost remain valid (bcrypt encodes its own cost factor) — login() upgrades
// them opportunistically rather than forcing a mass reset.
const SALT_ROUNDS = 12;
const DEFAULT_PLAN_SLUG = 'free';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const plan = await this.prisma.plan.findUnique({ where: { slug: DEFAULT_PLAN_SLUG } });
    if (!plan) throw new Error(`Default plan "${DEFAULT_PLAN_SLUG}" is not seeded`);

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    // One-time bootstrap: the very first account to sign up with the email
    // configured as SUPER_ADMIN_EMAIL becomes a super_admin — there's no
    // other way to create the first admin, since every other path requires
    // an existing super_admin to grant the role.
    const superAdminEmail = this.config.get<string>('SUPER_ADMIN_EMAIL');
    const role: Role =
      superAdminEmail && superAdminEmail.toLowerCase() === dto.email.toLowerCase() ? 'super_admin' : 'user';

    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name, planId: plan.id, role },
      include: { plan: true, organization: true },
    });

    return this.buildSession(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { plan: true, organization: true },
    });
    if (!user) throw new UnauthorizedException('Invalid email or password');

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'This account uses GitHub/GitLab login — sign in that way instead of with a password.',
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    if (bcrypt.getRounds(user.passwordHash) < SALT_ROUNDS) {
      const upgradedHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgradedHash } });
    }

    return this.buildSession(user);
  }

  /** Shared by password login/signup and the OAuth login-code exchange (see OAuthController). */
  buildSession(user: {
    id: string;
    email: string;
    name: string | null;
    createdAt: Date;
    plan: unknown;
    role: Role;
    isActive: boolean;
    organizationId: string | null;
    orgRole: OrgRole | null;
    organization: { id: string; name: string; slug: string } | null;
  }) {
    if (!user.isActive) {
      throw new UnauthorizedException('This account has been suspended. Contact an administrator.');
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    return {
      accessToken: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        plan: user.plan,
        role: user.role,
        // Flat shape (organization + top-level orgRole) matches GET /me
        // (see UsersService.SAFE_USER_SELECT) so refreshUser() and the
        // login/signup response are interchangeable on the frontend.
        organization: user.organization
          ? { id: user.organization.id, name: user.organization.name, slug: user.organization.slug }
          : null,
        orgRole: user.organization ? user.orgRole : null,
      },
    };
  }
}
