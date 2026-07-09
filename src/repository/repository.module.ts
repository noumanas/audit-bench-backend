import { Module } from '@nestjs/common';
import { RepositoryService } from './repository.service';
import { RepositoryController } from './repository.controller';
import { LlmModule } from '../llm/llm.module';
import { QuotaModule } from '../quota/quota.module';
import { PipelineModule } from '../audit/pipeline.module';

@Module({
  imports: [LlmModule, QuotaModule, PipelineModule],
  controllers: [RepositoryController],
  providers: [RepositoryService],
  exports: [RepositoryService],
})
export class RepositoryModule {}
