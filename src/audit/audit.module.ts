import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { LlmModule } from '../llm/llm.module';
import { QuotaModule } from '../quota/quota.module';
import { PipelineModule } from './pipeline.module';

@Module({
  imports: [LlmModule, QuotaModule, PipelineModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
