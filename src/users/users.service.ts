import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Explicit allow-list — never spread a raw User row to a client. That row
// carries passwordHash and a plaintext GitHub PAT (githubToken), neither of
// which should ever leave the server.
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  plan: true,
  githubUsername: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: SAFE_USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async changePlan(userId: string, slug: string) {
    const plan = await this.prisma.plan.findUnique({ where: { slug } });
    if (!plan) throw new BadRequestException(`Unknown plan "${slug}"`);

    return this.prisma.user.update({
      where: { id: userId },
      data: { planId: plan.id },
      select: SAFE_USER_SELECT,
    });
  }
}
