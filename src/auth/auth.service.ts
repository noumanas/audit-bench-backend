import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { unusableEmailReason } from "./email-domain";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { OrgRole, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WelcomeEmailService } from "../email/welcome-email.service";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";
import { JwtPayload } from "./types";
import { ActivityService } from "../activity/activity.service";
import { RequestContext } from "../activity/request-context";

// Bumped from 10 → 12 per current OWASP guidance. Existing hashes at the old
// cost remain valid (bcrypt encodes its own cost factor) — login() upgrades
// them opportunistically rather than forcing a mass reset.
const SALT_ROUNDS = 12;
const DEFAULT_PLAN_SLUG = "free";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly welcomeEmail: WelcomeEmailService,
    private readonly activity: ActivityService,
  ) {}

  async signup(dto: SignupDto, ctx: RequestContext) {
    const unusable = await unusableEmailReason(dto.email);
    if (unusable) throw new BadRequestException(unusable);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing)
      throw new ConflictException("An account with this email already exists");

    const plan = await this.prisma.plan.findUnique({
      where: { slug: DEFAULT_PLAN_SLUG },
    });
    if (!plan)
      throw new Error(`Default plan "${DEFAULT_PLAN_SLUG}" is not seeded`);

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    // Never an admin from a password signup: nothing here proves the person
    // owns the email address, so matching SUPER_ADMIN_EMAIL would let anyone
    // who registers it first take over the app. The first admin comes from a
    // provider-verified sign-in (OAuthService) or `npm run admin:promote`.
    const role: Role = "user";

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        planId: plan.id,
        role,
      },
      include: { plan: true, organization: true },
    });

    this.welcomeEmail.send(user);
    await this.activity.recordSignup(user, "password", ctx, dto.attribution);
    return this.buildSession(user);
  }

  async login(dto: LoginDto, ctx: RequestContext) {
    const failed = (reason: string, userId?: string) =>
      this.activity.log({
        type: "login_failed",
        userId,
        email: dto.email,
        method: "password",
        ctx,
        metadata: { reason },
      });

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { plan: true, organization: true },
    });
    if (!user) {
      await failed("unknown_email");
      throw new UnauthorizedException("Invalid email or password");
    }

    if (!user.passwordHash) {
      await failed("oauth_only_account", user.id);
      throw new UnauthorizedException(
        "This account uses Google/GitHub/GitLab login — sign in that way instead of with a password.",
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      await failed("wrong_password", user.id);
      throw new UnauthorizedException("Invalid email or password");
    }
    if (!user.isActive) await failed("suspended", user.id);

    if (bcrypt.getRounds(user.passwordHash) < SALT_ROUNDS) {
      const upgradedHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: upgradedHash },
      });
    }

    const session = this.buildSession(user);
    await this.activity.log({ type: "login", userId: user.id, email: user.email, method: "password", ctx });
    return session;
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
      throw new UnauthorizedException(
        "This account has been suspended. Contact an administrator.",
      );
    }

    // Fire-and-forget: a real sign-in (password, signup, or OAuth) shouldn't
    // wait on this, and a failure here shouldn't block the session either —
    // it's admin-visible metadata, not something login correctness depends on.
    this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => {});

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
          ? {
              id: user.organization.id,
              name: user.organization.name,
              slug: user.organization.slug,
            }
          : null,
        orgRole: user.organization ? user.orgRole : null,
      },
    };
  }
}
