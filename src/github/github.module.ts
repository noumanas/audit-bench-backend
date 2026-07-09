import { Module } from '@nestjs/common';
import { GithubService } from './github.service';
import { GithubController } from './github.controller';
import { RepositoryModule } from '../repository/repository.module';

@Module({
  imports: [RepositoryModule],
  controllers: [GithubController],
  providers: [GithubService],
})
export class GithubModule {}
