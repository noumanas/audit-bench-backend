import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Free and Enterprise are both nominally $0 (Enterprise is "contact sales"),
// so price alone can't order tiers correctly — rank by intended tier instead.
const TIER_ORDER = ['free', 'pro', 'team', 'enterprise'];

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const plans = await this.prisma.plan.findMany();
    return plans.sort((a, b) => TIER_ORDER.indexOf(a.slug) - TIER_ORDER.indexOf(b.slug));
  }
}
