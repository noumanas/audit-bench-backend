import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { QuotaService } from '../quota/quota.service';
import { PipelineService } from './pipeline.service';
import { detectLanguage } from '../common/language';
import { CreateAuditDto } from './dto/create-audit.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly quota: QuotaService,
    private readonly pipeline: PipelineService,
  ) {}

  async runAudit(userId: string, dto: CreateAuditDto) {
    const filename = dto.filename?.trim() || 'untitled';
    const language = detectLanguage(filename);
    const providerName = this.llm.resolveProvider(dto.provider);

    // Stage 1 (local, free) always runs; the LLM is only ever called if
    // Stage 1 flags something — and quota is only ever checked right
    // before that call, not for every request.
    const { result, fromCache } = await this.pipeline.run(
      { filename, language, code: dto.code, provider: providerName, focusAreas: dto.focusAreas },
      { beforeAiCall: () => this.quota.assertCanRunAudit(userId) },
    );

    const data = {
      userId,
      filename,
      language,
      provider: providerName,
      verdict: result.verdict,
      summary: result.summary,
      findings: result.findings as unknown as Prisma.InputJsonValue,
      stage1: result.stage1 as unknown as Prisma.InputJsonValue,
      aiInvoked: result.aiInvoked,
      fromCache,
      codeSize: dto.code.length,
    };

    const consumesQuota = !fromCache && result.aiInvoked;
    if (!consumesQuota) {
      return this.prisma.audit.create({ data });
    }

    // Re-check quota atomically with the insert — the fail-fast check inside
    // the pipeline only protects against wasting an LLM call; this closes
    // the race where concurrent requests could all pass that stale check
    // and all insert.
    return this.quota.withQuotaCheck(
      (db) => this.quota.assertCanRunAudit(userId, db),
      (db) => db.audit.create({ data }),
    );
  }

  async findOne(userId: string, id: string) {
    const audit = await this.prisma.audit.findUnique({ where: { id } });
    if (!audit || audit.userId !== userId) throw new NotFoundException(`Audit ${id} not found`);
    return audit;
  }

  async findRecent(userId: string, limit = 20) {
    return this.prisma.audit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
