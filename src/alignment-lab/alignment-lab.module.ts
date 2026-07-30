import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { QuotaModule } from '../quota/quota.module';
import { AlignmentLabController } from './alignment-lab.controller';
import { BenchmarkModelService } from './benchmark-model.service';
import { InvestigatorService } from './investigator.service';

@Module({
  imports: [LlmModule, QuotaModule],
  controllers: [AlignmentLabController],
  providers: [BenchmarkModelService, InvestigatorService],
})
export class AlignmentLabModule {}
