import { Module } from '@nestjs/common';
import { GitlabService } from './gitlab.service';
import { GitlabController } from './gitlab.controller';
import { RepositoryModule } from '../repository/repository.module';
import { PrFeedbackModule } from '../pr-feedback/pr-feedback.module';

@Module({
  imports: [RepositoryModule, PrFeedbackModule],
  controllers: [GitlabController],
  providers: [GitlabService],
  exports: [GitlabService],
})
export class GitlabModule {}
