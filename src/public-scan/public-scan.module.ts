import { Module } from '@nestjs/common';
import { RepositoryModule } from '../repository/repository.module';
import { GithubModule } from '../github/github.module';
import { PublicScanController, ScanShareController } from './public-scan.controller';
import { PublicScanService } from './public-scan.service';

@Module({
  imports: [RepositoryModule, GithubModule],
  controllers: [PublicScanController, ScanShareController],
  providers: [PublicScanService],
})
export class PublicScanModule {}
