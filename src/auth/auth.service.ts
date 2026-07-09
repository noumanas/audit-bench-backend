import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './types';

const SALT_ROUNDS = 10;
const DEFAULT_PLAN_SLUG = 'free';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const plan = await this.prisma.plan.findUnique({ where: { slug: DEFAULT_PLAN_SLUG } });
    if (!plan) throw new Error(`Default plan "${DEFAULT_PLAN_SLUG}" is not seeded`);

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name, planId: plan.id },
      include: { plan: true },
    });

    return this.buildSession(user.id, user.email, user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { plan: true },
    });
    if (!user) throw new UnauthorizedException('Invalid email or password');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    return this.buildSession(user.id, user.email, user);
  }

  private buildSession(
    id: string,
    email: string,
    user: { id: string; email: string; name: string | null; createdAt: Date; plan: unknown },
  ) {
    const payload: JwtPayload = { sub: id, email };
    return {
      accessToken: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        plan: user.plan,
      },
    };
  }
}
