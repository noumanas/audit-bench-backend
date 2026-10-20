import { Module } from '@nestjs/common';
import { RepositoryModule } from '../repository/repository.module';
import { PrFeedbackModule } from '../pr-feedback/pr-feedback.module';
import { BitbucketController } from './bitbucket.controller';
import { BitbucketService } from './bitbucket.service';

@Module({
  imports: [RepositoryModule, PrFeedbackModule],
  controllers: [BitbucketController],
  providers: [BitbucketService],
  exports: [BitbucketService],
})
export class BitbucketModule {}
