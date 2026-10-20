import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { findingFingerprint } from '../common/finding-fingerprint';

export const RULE_KINDS = ['instruction', 'ignore_path', 'suppress'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

const NEGATIVE = ['down', 'not_an_issue', 'wont_fix'];
const POSITIVE = ['up', 'resolved'];
/** Dismissals of one kind of finding, in one repo, before it becomes a learned rule. */
export const LEARN_THRESHOLD = 2;
const MAX_PROMPT_RULES = 30;

export type FeedbackSignal = 'up' | 'down' | 'not_an_issue' | 'resolved' | 'wont_fix';

export interface Owner {
  id: string;
  organizationId: string | null;
}

/** What a review needs from the rules in scope. */
export interface ReviewRules {
  instructions: string[];
  ignorePaths: string[];
  suppress: Array<{ fingerprint: string; text: string }>;
  /** Stable hash of everything above: part of the AI cache key, so editing rules re-reviews instead of reusing. */
  key: string;
}

export const NO_RULES: ReviewRules = { instructions: [], ignorePaths: [], suppress: [], key: '' };

/** "owner/repo" from a scan's source name ("owner/repo#12", "group/project !3", "owner/repo"); null for a zip upload. */
export function repoFromSourceName(sourceName: string, sourceType: string): string | null {
  if (sourceType === 'zip') return null;
  return sourceName.replace(/\s*[#!]\d+$/, '').trim() || null;
}

/** The rules as prompt text for the AI. Empty when there are none. */
export function rulesPromptText(rules: ReviewRules): string {
  const parts: string[] = [];
  if (rules.instructions.length) {
    parts.push(
      `Team rules (follow them; they override the defaults above):\n${rules.instructions.map((r) => `- ${r}`).join('\n')}`,
    );
  }
  if (rules.suppress.length) {
    parts.push(
      `The team has said these kinds of comments aren't useful to them. Don't raise them:\n${rules.suppress.map((r) => `- ${r.text}`).join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * Team review rules, and learning from feedback. Rules belong to a user, or
 * to their whole team when shared; feedback (reactions, how threads ended,
 * "won't fix" in the app) turns a kind of finding the team keeps dismissing
 * into a learned suppress rule they can see and switch off.
 */
@Injectable()
export class ReviewRulesService {
  private readonly logger = new Logger(ReviewRulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  private scope(owner: Owner): Prisma.ReviewRuleWhereInput {
    return owner.organizationId
      ? { OR: [{ organizationId: owner.organizationId }, { userId: owner.id, organizationId: null }] }
      : { userId: owner.id, organizationId: null };
  }

  async list(owner: Owner) {
    return this.prisma.reviewRule.findMany({
      where: this.scope(owner),
      orderBy: [{ source: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(owner: Owner, input: { kind: RuleKind; text: string; repo?: string | null; shared?: boolean }) {
    const text = input.text.trim();
    if (!text) throw new BadRequestException('Write the rule first.');
    if (input.shared && !owner.organizationId)
      throw new BadRequestException('Join or create a team to share rules with it.');
    if (input.shared) await this.assertCanManageTeamRules(owner);
    return this.prisma.reviewRule.create({
      data: {
        userId: owner.id,
        organizationId: input.shared ? owner.organizationId : null,
        repo: input.repo?.trim() || null,
        kind: input.kind,
        text,
        // Hand-written rules steer the AI through the prompt; only learned
        // rules carry an exact fingerprint to filter findings by.
        fingerprint: null,
      },
    });
  }

  async update(owner: Owner, id: string, input: { enabled?: boolean; text?: string }) {
    const rule = await this.ownRule(owner, id);
    return this.prisma.reviewRule.update({
      where: { id: rule.id },
      data: {
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.text === undefined ? {} : { text: input.text.trim() }),
      },
    });
  }

  async remove(owner: Owner, id: string) {
    const rule = await this.ownRule(owner, id);
    await this.prisma.reviewRule.delete({ where: { id: rule.id } });
    return { deleted: true };
  }

  private async ownRule(owner: Owner, id: string) {
    const rule = await this.prisma.reviewRule.findFirst({ where: { id, ...this.scope(owner) } });
    if (!rule) throw new NotFoundException('Rule not found');
    if (rule.organizationId) await this.assertCanManageTeamRules(owner);
    return rule;
  }

  private async assertCanManageTeamRules(owner: Owner) {
    const user = await this.prisma.user.findUnique({ where: { id: owner.id }, select: { orgRole: true } });
    if (user?.orgRole !== 'owner' && user?.orgRole !== 'admin') {
      throw new ForbiddenException("Only your team's owners and admins can change team-wide rules.");
    }
  }

  /** The enabled rules that apply to a review of `repo` (null: a zip upload, so only rules for every repo). */
  async rulesFor(owner: Owner, repo: string | null): Promise<ReviewRules> {
    const rows = await this.prisma.reviewRule.findMany({
      where: {
        AND: [
          this.scope(owner),
          { enabled: true },
          repo ? { OR: [{ repo: null }, { repo: { equals: repo, mode: 'insensitive' } }] } : { repo: null },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const rules: ReviewRules = {
      instructions: rows
        .filter((r) => r.kind === 'instruction')
        .map((r) => r.text)
        .slice(0, MAX_PROMPT_RULES),
      ignorePaths: rows.filter((r) => r.kind === 'ignore_path').map((r) => r.text),
      suppress: rows
        .filter((r) => r.kind === 'suppress')
        .map((r) => ({ fingerprint: r.fingerprint ?? '', text: r.text }))
        .slice(0, MAX_PROMPT_RULES),
      key: '',
    };
    const hasAny = rules.instructions.length || rules.ignorePaths.length || rules.suppress.length;
    rules.key = hasAny ? createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 16) : '';
    return rules;
  }

  /** Records one signal (idempotent per sourceRef) and updates the learned rule for that kind of finding. */
  async recordFeedback(
    owner: Owner,
    f: {
      repo: string;
      path: string;
      category: string;
      title: string;
      signal: FeedbackSignal;
      source: string;
      sourceRef: string;
    },
  ) {
    const fingerprint = findingFingerprint(f);
    try {
      await this.prisma.findingFeedback.upsert({
        where: { sourceRef: f.sourceRef },
        create: { ...f, fingerprint, userId: owner.id, organizationId: owner.organizationId },
        update: { signal: f.signal },
      });
      await this.learn(owner, f.repo, fingerprint, f.title, f.category);
    } catch (err) {
      this.logger.warn(`Couldn't record feedback ${f.sourceRef}: ${(err as Error).message}`);
    }
  }

  /** Withdraws a signal, e.g. a finding set back to "open" in the app. */
  async withdrawFeedback(owner: Owner, sourceRef: string) {
    const fb = await this.prisma.findingFeedback.findUnique({ where: { sourceRef } });
    if (!fb) return;
    await this.prisma.findingFeedback.delete({ where: { sourceRef } });
    await this.learn(owner, fb.repo, fb.fingerprint, fb.title, fb.category);
  }

  /**
   * Turns repeated dismissals into a learned rule: at LEARN_THRESHOLD
   * negative signals that outnumber the positive ones, for one kind of
   * finding in one repo. Keeps the evidence count current (a learned rule
   * the team switched off stays off), and removes the rule once the
   * evidence no longer supports it.
   */
  async learn(owner: Owner, repo: string, fingerprint: string, title: string, category: string) {
    const signals = await this.prisma.findingFeedback.groupBy({
      by: ['signal'],
      where: {
        repo: { equals: repo, mode: 'insensitive' },
        fingerprint,
        ...(owner.organizationId
          ? { organizationId: owner.organizationId }
          : { userId: owner.id, organizationId: null }),
      },
      _count: { _all: true },
    });
    const count = (names: string[]) =>
      signals.filter((s) => names.includes(s.signal)).reduce((n, s) => n + s._count._all, 0);
    const negative = count(NEGATIVE);
    const positive = count(POSITIVE);

    const existing = await this.prisma.reviewRule.findFirst({
      where: {
        kind: 'suppress',
        source: 'learned',
        fingerprint,
        repo: { equals: repo, mode: 'insensitive' },
        ...this.scope(owner),
      },
    });
    const learned = negative >= LEARN_THRESHOLD && negative > positive;
    if (existing) {
      // Evidence withdrawn (a finding reopened, a 👍 outweighing the 👎s): forget it; it's relearned if dismissed again.
      if (learned) await this.prisma.reviewRule.update({ where: { id: existing.id }, data: { evidence: negative } });
      else await this.prisma.reviewRule.delete({ where: { id: existing.id } });
      return;
    }
    if (learned) {
      await this.prisma.reviewRule.create({
        data: {
          userId: owner.id,
          organizationId: owner.organizationId,
          repo,
          kind: 'suppress',
          source: 'learned',
          fingerprint,
          evidence: negative,
          text: `${title} (${category})`,
        },
      });
      this.logger.log(`Learned to skip "${title}" in ${repo}`);
    }
  }
}
