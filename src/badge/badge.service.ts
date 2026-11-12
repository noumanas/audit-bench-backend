import { Injectable, NotFoundException } from '@nestjs/common';
import { Verdict } from '@prisma/client';
import { BRAND_MARK_SVG } from '../common/brand';
import { PrismaService } from '../prisma/prisma.service';

const COLOR: Record<Verdict, string> = { pass: 'brightgreen', needs_work: 'yellow', do_not_ship: 'red' };
const LABEL: Record<Verdict, string> = { pass: 'passing', needs_work: 'needs work', do_not_ship: 'failing' };

/** shields.io "endpoint" badge JSON — https://shields.io/badges/endpoint-badge */
export interface ShieldsBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  labelColor: string;
  logoSvg: string;
}

// Brand label (white mark on black); the verdict side keeps its status colour.
const BRAND = { labelColor: '000000', logoSvg: BRAND_MARK_SVG };

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
      return { schemaVersion: 1, label: 'Audit Bench Ai', message: 'no scans yet', color: 'lightgrey', ...BRAND };
    }

    return {
      schemaVersion: 1,
      label: 'Audit Bench Ai',
      message: LABEL[job.verdict],
      color: COLOR[job.verdict],
      ...BRAND,
    };
  }
}
