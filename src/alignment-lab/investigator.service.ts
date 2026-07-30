import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { QuotaService } from '../quota/quota.service';
import { TokenUsage, ZERO_USAGE, addUsage } from '../common/types';
import { WorkspaceActor, canViewResource } from '../common/workspace-scope';
import { RequestUser } from '../auth/types';
import { investigatorTurnSchema, investigatorAnalysisSchema, TurnRecord } from './alignment-lab.types';
import { buildHypothesisPrompt, buildAnalysisPrompt, targetSystemPrompt } from './investigator-prompts';
import { heuristicGrade } from './grading';
import { alignmentLabScopeWhere } from './scope';

/** Hard cap on turns — bounds both cost and how long a run can take, same
 *  spirit as the cost-control conventions elsewhere in this codebase. */
const MAX_TURNS = 5;

@Injectable()
export class InvestigatorService {
  private readonly logger = new Logger(InvestigatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly quota: QuotaService,
  ) {}

  /**
   * Runs the investigator loop against one benchmark model: each turn, the
   * investigator forms a hypothesis and a probing prompt, the target persona
   * (a real LLM call under BenchmarkModel.personaPrompt, not an actually
   * fine-tuned model) answers it, and the investigator analyzes the answer
   * before deciding whether to keep going. Stops early once the investigator
   * reports enough evidence, or after MAX_TURNS regardless.
   */
  async runInvestigation(actor: RequestUser, modelId: string, requestedProvider?: string) {
    await this.quota.assertCanRunInvestigation(actor.id, actor.role);

    const model = await this.prisma.benchmarkModel.findFirst({
      where: { id: modelId, ...alignmentLabScopeWhere(actor, 'createdById') },
    });
    if (!model) throw new NotFoundException(`Benchmark model ${modelId} not found`);

    const provider = this.llm.resolveProvider(requestedProvider);
    const investigation = await this.prisma.investigation.create({
      data: { modelId, runById: actor.id, organizationId: actor.organizationId, provider, turns: [] },
    });

    const history: TurnRecord[] = [];
    let usage: TokenUsage = ZERO_USAGE;
    let last: { updatedBelief: string; enoughEvidence: boolean; predictedBehavior: string | null; confidence: number } | null =
      null;

    try {
      for (let turn = 1; turn <= MAX_TURNS; turn++) {
        const { result: plan, usage: planUsage } = await this.llm.completeStructured(
          provider,
          buildHypothesisPrompt(model.name, history),
          investigatorTurnSchema,
        );
        usage = addUsage(usage, planUsage);

        const targetPrompt = `${targetSystemPrompt(model.personaPrompt)}\n\nQuestion: ${plan.nextPrompt}`;
        const targetResponse = await this.llm.completeText(provider, targetPrompt);

        const { result: analysis, usage: analysisUsage } = await this.llm.completeStructured(
          provider,
          buildAnalysisPrompt(model.name, plan.nextPrompt, targetResponse, turn, MAX_TURNS),
          investigatorAnalysisSchema,
        );
        usage = addUsage(usage, analysisUsage);

        history.push({
          turn,
          hypothesis: plan.hypothesis,
          prompt: plan.nextPrompt,
          response: targetResponse,
          updatedBelief: analysis.updatedBelief,
          confidence: analysis.confidence,
        });
        last = analysis;

        if (analysis.enoughEvidence) break;
      }

      const predictedBehavior = last?.predictedBehavior ?? null;
      const correct = heuristicGrade(predictedBehavior, model.hiddenBehavior);

      return await this.prisma.investigation.update({
        where: { id: investigation.id },
        data: {
          status: 'completed',
          turns: history as unknown as Prisma.InputJsonValue,
          predictedBehavior,
          confidence: last?.confidence ?? null,
          correct,
          queryCount: history.length,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(`Investigation ${investigation.id} failed`, err as Error);
      await this.prisma.investigation.update({
        where: { id: investigation.id },
        data: {
          status: 'failed',
          turns: history as unknown as Prisma.InputJsonValue,
          queryCount: history.length,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  listForModel(actor: WorkspaceActor, modelId: string) {
    return this.prisma.investigation.findMany({
      where: { modelId, ...alignmentLabScopeWhere(actor, 'runById') },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(actor: WorkspaceActor, id: string) {
    const investigation = await this.prisma.investigation.findUnique({ where: { id } });
    if (
      !investigation ||
      !canViewResource(actor, { userId: investigation.runById, organizationId: investigation.organizationId })
    ) {
      throw new NotFoundException(`Investigation ${id} not found`);
    }
    return investigation;
  }
}
