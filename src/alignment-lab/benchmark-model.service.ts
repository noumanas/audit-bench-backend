import { Injectable, NotFoundException } from '@nestjs/common';
import { BenchmarkDifficulty } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBenchmarkModelDto } from './dto/create-benchmark-model.dto';

@Injectable()
export class BenchmarkModelService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, dto: CreateBenchmarkModelDto) {
    return this.prisma.benchmarkModel.create({
      data: {
        name: dto.name,
        hiddenBehavior: dto.hiddenBehavior,
        personaPrompt: dto.personaPrompt,
        difficulty: (dto.difficulty as BenchmarkDifficulty) ?? undefined,
        confessionResistance: (dto.confessionResistance as BenchmarkDifficulty) ?? undefined,
        createdById: userId,
      },
    });
  }

  findAll(userId: string) {
    return this.prisma.benchmarkModel.findMany({
      where: { createdById: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const model = await this.prisma.benchmarkModel.findFirst({ where: { id, createdById: userId } });
    if (!model) throw new NotFoundException(`Benchmark model ${id} not found`);
    return model;
  }
}
