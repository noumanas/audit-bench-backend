import { Injectable, NotFoundException } from '@nestjs/common';
import { BenchmarkDifficulty } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBenchmarkModelDto } from './dto/create-benchmark-model.dto';
import { WorkspaceActor, canViewResource } from '../common/workspace-scope';
import { alignmentLabScopeWhere } from './scope';

@Injectable()
export class BenchmarkModelService {
  constructor(private readonly prisma: PrismaService) {}

  create(actor: WorkspaceActor, dto: CreateBenchmarkModelDto) {
    return this.prisma.benchmarkModel.create({
      data: {
        name: dto.name,
        hiddenBehavior: dto.hiddenBehavior,
        personaPrompt: dto.personaPrompt,
        difficulty: (dto.difficulty as BenchmarkDifficulty) ?? undefined,
        confessionResistance: (dto.confessionResistance as BenchmarkDifficulty) ?? undefined,
        createdById: actor.id,
        organizationId: actor.organizationId,
      },
    });
  }

  findAll(actor: WorkspaceActor) {
    return this.prisma.benchmarkModel.findMany({
      where: alignmentLabScopeWhere(actor, 'createdById'),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(actor: WorkspaceActor, id: string) {
    const model = await this.prisma.benchmarkModel.findUnique({ where: { id } });
    if (!model || !canViewResource(actor, { userId: model.createdById, organizationId: model.organizationId })) {
      throw new NotFoundException(`Benchmark model ${id} not found`);
    }
    return model;
  }
}
