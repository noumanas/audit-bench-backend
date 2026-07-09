import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { AuditCacheService } from './cache.service';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  providers: [PipelineService, AuditCacheService],
  exports: [PipelineService, AuditCacheService],
})
export class PipelineModule {}
