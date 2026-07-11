import { Module } from '@nestjs/common';
import { RepositoryService } from './repository.service';
import { RepositoryController } from './repository.controller';
import { LlmModule } from '../llm/llm.module';
import { QuotaModule } from '../quota/quota.module';
import { PipelineModule } from '../audit/pipeline.module';
import { PrFeedbackModule } from '../pr-feedback/pr-feedback.module';

@Module({
  imports: [LlmModule, QuotaModule, PipelineModule, PrFeedbackModule],
  controllers: [RepositoryController],
  providers: [RepositoryService],
  exports: [RepositoryService],
})
export class RepositoryModule {}
