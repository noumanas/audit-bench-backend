import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { AlignmentLabController } from './alignment-lab.controller';
import { BenchmarkModelService } from './benchmark-model.service';
import { InvestigatorService } from './investigator.service';

@Module({
  imports: [LlmModule],
  controllers: [AlignmentLabController],
  providers: [BenchmarkModelService, InvestigatorService],
})
export class AlignmentLabModule {}
