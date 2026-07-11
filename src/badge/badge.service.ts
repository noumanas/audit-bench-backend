import { Injectable, NotFoundException } from '@nestjs/common';
import { Verdict } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const COLOR: Record<Verdict, string> = { pass: 'brightgreen', needs_work: 'yellow', do_not_ship: 'red' };
const LABEL: Record<Verdict, string> = { pass: 'passing', needs_work: 'needs work', do_not_ship: 'failing' };

/** shields.io "endpoint" badge JSON — https://shields.io/badges/endpoint-badge */
export interface ShieldsBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

@Injectable()
export class BadgeService {
  constructor(private readonly prisma: PrismaService) {}

  async getVerdictBadge(badgeToken: string, repo?: string): Promise<ShieldsBadge> {
    const user = await this.prisma.user.findUnique({ where: { badgeToken } });
    if (!user) throw new NotFoundException('Unknown badge token');

    const job = await this.prisma.scanJob.findFirst({
      where: { userId: user.id, status: 'completed', verdict: { not: null }, ...(repo ? { sourceName: repo } : {}) },
      orderBy: { completedAt: 'desc' },
    });

    if (!job?.verdict) {
      return { schemaVersion: 1, label: 'audit/bench', message: 'no scans yet', color: 'lightgrey' };
    }

    return { schemaVersion: 1, label: 'audit/bench', message: LABEL[job.verdict], color: COLOR[job.verdict] };
  }
}
