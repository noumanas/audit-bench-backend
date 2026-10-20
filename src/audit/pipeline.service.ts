import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { AuditCacheService, CachedAuditResult, cacheExtraKey } from './cache.service';
import { auditResultSchema } from '../common/finding.schema';
import { AuditResult, LlmProviderName, TokenUsage, ZERO_USAGE, addUsage } from '../common/types';
import { verdictForSeverities, worstVerdict } from '../common/verdict';
import { LineRange } from '../common/diff-ranges';
import { runStage1 } from './stage1/run-stage1';
import { stage1ToFindings } from './stage1/to-findings';
import { filterStage1ToRanges } from './stage1/filter-to-ranges';
import { findingFingerprint } from '../common/finding-fingerprint';
import { buildDiffPrompt, buildFocusedPrompt } from './stage2/focused-prompt';

export interface PipelineInput {
  filename: string;
  language?: string;
  code: string;
  provider: LlmProviderName;
  focusAreas?: string[];
  repoContext?: string;
  /** Scopes the whole run to a PR/MR's changed lines — see filterStage1ToRanges. */
  changedLineRanges?: LineRange[];
  /**
   * Never call the AI: return Stage 1's findings even when it flags risky
   * code. Used for free anonymous scans. A cached full result is still
   * served (it costs nothing), but a local-only result is never cached, so
   * it can't later stand in for a real AI review of the same code.
   */
  localOnly?: boolean;
  /** The team's rules as prompt text — see ReviewRulesService. */
  teamRules?: string;
  /** Learned "don't flag this" fingerprints: such findings are dropped, whatever the AI says. */
  suppressFingerprints?: string[];
  /** Changes whenever the rules do, so a cached review made under other rules isn't reused. */
  rulesKey?: string;
  /** PR/MR reviews: unchanged code elsewhere that uses what this file's changes touch. */
  relatedContext?: string;
}

export interface PipelineOptions {
  /**
   * Called immediately before the (only) LLM call this run will make —
   * i.e. only when Stage 1 found something worth escalating. Throw here to
   * block the call (e.g. over quota) before spending anything on it. Never
   * called for a cache hit or a Stage-1-only ("clean") result.
   */
  beforeAiCall?: () => Promise<void>;
}

export interface PipelineOutput {
  result: CachedAuditResult;
  fromCache: boolean;
  /** Tokens actually spent on THIS call — zero for a cache hit or a Stage-1-only ("clean") result. */
  usage: TokenUsage;
}

const LOW_CONFIDENCE_THRESHOLD = 0.6;

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly cache: AuditCacheService,
  ) {}

  async run(input: PipelineInput, opts: PipelineOptions = {}): Promise<PipelineOutput> {
    const hash = this.cache.hashFor(
      input.code,
      input.provider,
      input.focusAreas,
      input.changedLineRanges,
      cacheExtraKey(input.rulesKey, input.relatedContext),
    );
    const suppressed = new Set(input.suppressFingerprints ?? []);
    const keep = <T extends { category?: string | null; title: string }>(findings: T[]) =>
      suppressed.size ? findings.filter((f) => !suppressed.has(findingFingerprint(f))) : findings;
    const cached = await this.cache.lookup(hash);
    if (cached) {
      return { result: cached, fromCache: true, usage: ZERO_USAGE };
    }

    const fullStage1 = await runStage1(input.code, input.filename);
    const stage1 = input.changedLineRanges ? filterStage1ToRanges(fullStage1, input.changedLineRanges) : fullStage1;
    const baseFindings = keep(stage1ToFindings(stage1));

    let result: CachedAuditResult;
    let usage: TokenUsage = ZERO_USAGE;

    // A PR/MR review sends its changed hunks to the AI whatever Stage 1
    // found: Stage 1 only flags JavaScript/TypeScript functions and Python
    // errors, so gating on it left most PRs (Java, Go, Kotlin…) unreviewed.
    const diffReview = !input.localOnly && Boolean(input.changedLineRanges?.length);

    if (!stage1.clean && input.localOnly) {
      return {
        result: {
          verdict: verdictForSeverities(baseFindings),
          summary: `Local checks found ${baseFindings.length} issue(s) and flagged ${stage1.riskyFunctions.length} function(s) that would get an AI review on a full scan.`,
          findings: baseFindings,
          stage1,
          aiInvoked: false,
        },
        fromCache: false,
        usage,
      };
    }

    if (stage1.clean && !diffReview) {
      result = {
        verdict: verdictForSeverities(baseFindings),
        summary:
          baseFindings.length > 0
            ? `Local checks (JavaScript/TypeScript, Python, complexity, formatting) found ${baseFindings.length} minor issue(s). Nothing here warranted an AI review, so no AI credits were used.`
            : 'Local checks (JavaScript/TypeScript, Python, complexity, formatting) found nothing. No AI credits were used.',
        findings: baseFindings,
        stage1,
        aiInvoked: false,
      };
    } else {
      await opts.beforeAiCall?.();

      const prompt = diffReview
        ? buildDiffPrompt({
            filename: input.filename,
            language: input.language,
            code: input.code,
            changedRanges: input.changedLineRanges!,
            relatedContext: input.relatedContext,
            repoContext: input.repoContext,
            focusAreas: input.focusAreas,
            teamRules: input.teamRules,
          })
        : buildFocusedPrompt({
            filename: input.filename,
            language: input.language,
            riskyFunctions: stage1.riskyFunctions,
            allFunctions: stage1.functions,
            repoContext: input.repoContext,
            focusAreas: input.focusAreas,
            teamRules: input.teamRules,
          });

      const first = await this.llm.completeStructured<AuditResult>(input.provider, prompt, auditResultSchema);
      let aiResult = first.result;
      usage = addUsage(usage, first.usage);

      const needsEscalation =
        this.llm.hasEscalationModel(input.provider) &&
        aiResult.findings.some(
          (f) => f.confidence < LOW_CONFIDENCE_THRESHOLD && (f.severity === 'critical' || f.severity === 'high'),
        );

      if (needsEscalation) {
        try {
          const escalated = await this.llm.completeStructured<AuditResult>(input.provider, prompt, auditResultSchema, {
            escalate: true,
          });
          aiResult = escalated.result;
          usage = addUsage(usage, escalated.usage);
        } catch (err) {
          this.logger.warn(`Escalation pass failed, keeping first-pass result: ${(err as Error).message}`);
        }
      }

      const aiFindings = keep(aiResult.findings);
      const findings = [...baseFindings, ...aiFindings];
      result = {
        // If the team's rules removed findings, judge what's left rather than the AI's verdict on all of them.
        verdict: worstVerdict([
          aiFindings.length === aiResult.findings.length ? aiResult.verdict : verdictForSeverities(aiFindings),
          verdictForSeverities(baseFindings),
        ]),
        summary: aiResult.summary,
        findings,
        stage1,
        aiInvoked: true,
      };
    }

    await this.cache.store(hash, result);
    return { result, fromCache: false, usage };
  }
}
