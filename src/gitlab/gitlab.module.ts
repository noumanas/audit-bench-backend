import { Module } from '@nestjs/common';
import { GitlabService } from './gitlab.service';
import { GitlabController } from './gitlab.controller';
import { RepositoryModule } from '../repository/repository.module';

@Module({
  imports: [RepositoryModule],
  controllers: [GitlabController],
  providers: [GitlabService],
})
export class GitlabModule {}
