import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditResult } from '../common/types';
import { LineRange } from '../common/diff-ranges';
import { Stage1Result } from './stage1/types';

export interface CachedAuditResult extends AuditResult {
  stage1: Stage1Result | null;
  aiInvoked: boolean;
}

@Injectable()
export class AuditCacheService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Same content + provider + focus areas always audits identically — and
   * a diff-scoped review (PR/MR) of the same content but different changed
   * ranges is a genuinely different result, so ranges are part of the key.
   */
  hashFor(content: string, provider: string, focusAreas: string[] = [], changedRanges?: LineRange[]): string {
    const rangesPart = changedRanges ? changedRanges.map((r) => `${r.start}-${r.end}`).join(',') : '';
    const normalized = `${content} ${provider} ${[...focusAreas].sort().join(',')} ${rangesPart}`;
    return createHash('sha256').update(normalized).digest('hex');
  }

  /** Existence check with no side effects — for deciding whether a fresh AI call is needed without inflating hit stats. */
  async exists(contentHash: string): Promise<boolean> {
    const hit = await this.prisma.auditCache.findUnique({ where: { contentHash }, select: { contentHash: true } });
    return hit !== null;
  }

  async lookup(contentHash: string): Promise<CachedAuditResult | null> {
    const hit = await this.prisma.auditCache.findUnique({ where: { contentHash } });
    if (!hit) return null;

    await this.prisma.auditCache.update({
      where: { contentHash },
      data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
    });

    return {
      verdict: hit.verdict,
      summary: hit.summary,
      findings: hit.findings as unknown as AuditResult['findings'],
      stage1: (hit.stage1 as unknown as Stage1Result) ?? null,
      aiInvoked: hit.aiInvoked,
    };
  }

  async store(contentHash: string, result: CachedAuditResult): Promise<void> {
    await this.prisma.auditCache.upsert({
      where: { contentHash },
      create: {
        contentHash,
        verdict: result.verdict,
        summary: result.summary,
        findings: result.findings as unknown as Prisma.InputJsonValue,
        stage1: result.stage1 as unknown as Prisma.InputJsonValue,
        aiInvoked: result.aiInvoked,
      },
      update: {
        verdict: result.verdict,
        summary: result.summary,
        findings: result.findings as unknown as Prisma.InputJsonValue,
        stage1: result.stage1 as unknown as Prisma.InputJsonValue,
        aiInvoked: result.aiInvoked,
      },
    });
  }
}
