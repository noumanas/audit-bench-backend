import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { GithubModule } from '../github/github.module';
import { GitlabModule } from '../gitlab/gitlab.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [GithubModule, GitlabModule, LlmModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
