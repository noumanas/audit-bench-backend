import { Module } from '@nestjs/common';
import { FixService } from './fix.service';
import { FixController } from './fix.controller';
import { GithubModule } from '../github/github.module';
import { GitlabModule } from '../gitlab/gitlab.module';
import { PipelineModule } from '../audit/pipeline.module';
import { QuotaModule } from '../quota/quota.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [GithubModule, GitlabModule, PipelineModule, QuotaModule, LlmModule],
  controllers: [FixController],
  providers: [FixService],
})
export class FixModule {}
