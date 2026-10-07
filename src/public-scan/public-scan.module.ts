import { Module } from '@nestjs/common';
import { RepositoryModule } from '../repository/repository.module';
import { PublicScanController, ScanShareController } from './public-scan.controller';
import { PublicScanService } from './public-scan.service';

@Module({
  imports: [RepositoryModule],
  controllers: [PublicScanController, ScanShareController],
  providers: [PublicScanService],
})
export class PublicScanModule {}
