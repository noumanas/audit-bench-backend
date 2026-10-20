import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { GithubAppController, GithubAppWebhookController } from './github-app.controller';
import { GithubAppService } from './github-app.service';

@Module({
  imports: [GithubModule, WebhooksModule],
  controllers: [GithubAppController, GithubAppWebhookController],
  providers: [GithubAppService],
})
export class GithubAppModule {}
