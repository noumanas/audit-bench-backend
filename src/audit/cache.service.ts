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

/**
 * The part of a cache key that isn't the code itself: the team's rules and
 * the related code a PR review was shown. Empty when neither applies, so
 * keys made before either existed stay valid.
 */
export function cacheExtraKey(rulesKey?: string, relatedContext?: string, mode?: 'local'): string | undefined {
  const parts = [
    rulesKey,
    relatedContext ? `ctx:${createHash('sha256').update(relatedContext).digest('hex').slice(0, 16)}` : undefined,
    // A free, local-only PR review must never be served to a full one (or the reverse).
    mode ? `mode:${mode}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join('|') : undefined;
}

@Injectable()
export class AuditCacheService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Same content + provider + focus areas always audits identically — and
   * a diff-scoped review (PR/MR) of the same content but different changed
   * ranges is a genuinely different result, so ranges are part of the key.
   */
  hashFor(
    content: string,
    provider: string,
    focusAreas: string[] = [],
    changedRanges?: LineRange[],
    rulesKey?: string,
  ): string {
    // "diff-v2": PR reviews now always get an AI pass (see PipelineService.run),
    // so results cached before that — often local-only "clean" ones — don't apply.
    const rangesPart = changedRanges ? `diff-v2:${changedRanges.map((r) => `${r.start}-${r.end}`).join(',')}` : '';
    // Only appended when a team has rules, so every existing cache key stays valid.
    const normalized = `${content} ${provider} ${[...focusAreas].sort().join(',')} ${rangesPart}${rulesKey ? ` rules:${rulesKey}` : ''}`;
    return createHash('sha256').update(normalized).digest('hex');
  }

  /** Existence check with no side effects — for deciding whether a fresh AI call is needed without inflating hit stats. */
  async exists(contentHash: string): Promise<boolean> {
    return (await this.peek(contentHash)) !== null;
  }

  /** Whether a cached result exists and if it came from an AI review, with no side effects. */
  async peek(contentHash: string): Promise<{ aiInvoked: boolean } | null> {
    return this.prisma.auditCache.findUnique({ where: { contentHash }, select: { aiInvoked: true } });
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
