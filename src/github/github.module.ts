import { Module } from '@nestjs/common';
import { GithubService } from './github.service';
import { GithubController } from './github.controller';
import { RepositoryModule } from '../repository/repository.module';
import { PrFeedbackModule } from '../pr-feedback/pr-feedback.module';

@Module({
  imports: [RepositoryModule, PrFeedbackModule],
  controllers: [GithubController],
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
