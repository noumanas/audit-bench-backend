import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { AuditCacheService, CachedAuditResult } from './cache.service';
import { auditResultSchema } from '../common/finding.schema';
import { AuditResult, LlmProviderName } from '../common/types';
import { verdictForSeverities, worstVerdict } from '../common/verdict';
import { LineRange } from '../common/diff-ranges';
import { runStage1 } from './stage1/run-stage1';
import { stage1ToFindings } from './stage1/to-findings';
import { filterStage1ToRanges } from './stage1/filter-to-ranges';
import { buildFocusedPrompt } from './stage2/focused-prompt';

export interface PipelineInput {
  filename: string;
  language?: string;
  code: string;
  provider: LlmProviderName;
  focusAreas?: string[];
  repoContext?: string;
  /** Scopes the whole run to a PR/MR's changed lines — see filterStage1ToRanges. */
  changedLineRanges?: LineRange[];
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
    const hash = this.cache.hashFor(input.code, input.provider, input.focusAreas, input.changedLineRanges);
    const cached = await this.cache.lookup(hash);
    if (cached) {
      return { result: cached, fromCache: true };
    }

    const fullStage1 = await runStage1(input.code, input.filename);
    const stage1 = input.changedLineRanges
      ? filterStage1ToRanges(fullStage1, input.changedLineRanges)
      : fullStage1;
    const baseFindings = stage1ToFindings(stage1);

    let result: CachedAuditResult;

    if (stage1.clean) {
      result = {
        verdict: verdictForSeverities(baseFindings),
        summary:
          baseFindings.length > 0
            ? `Local checks (ESLint, TypeScript, complexity, formatting) found ${baseFindings.length} minor issue(s). Nothing here warranted an AI review, so no AI credits were used.`
            : 'Local checks (ESLint, TypeScript, complexity, formatting) found nothing. No AI credits were used.',
        findings: baseFindings,
        stage1,
        aiInvoked: false,
      };
    } else {
      await opts.beforeAiCall?.();

      const prompt = buildFocusedPrompt({
        filename: input.filename,
        language: input.language,
        riskyFunctions: stage1.riskyFunctions,
        allFunctions: stage1.functions,
        repoContext: input.repoContext,
        focusAreas: input.focusAreas,
      });

      let aiResult = await this.llm.completeStructured<AuditResult>(input.provider, prompt, auditResultSchema);

      const needsEscalation =
        this.llm.hasEscalationModel(input.provider) &&
        aiResult.findings.some(
          (f) => f.confidence < LOW_CONFIDENCE_THRESHOLD && (f.severity === 'critical' || f.severity === 'high'),
        );

      if (needsEscalation) {
        try {
          aiResult = await this.llm.completeStructured<AuditResult>(input.provider, prompt, auditResultSchema, {
            escalate: true,
          });
        } catch (err) {
          this.logger.warn(`Escalation pass failed, keeping first-pass result: ${(err as Error).message}`);
        }
      }

      const findings = [...baseFindings, ...aiResult.findings];
      result = {
        verdict: worstVerdict([aiResult.verdict, verdictForSeverities(baseFindings)]),
        summary: aiResult.summary,
        findings,
        stage1,
        aiInvoked: true,
      };
    }

    await this.cache.store(hash, result);
    return { result, fromCache: false };
  }
}
