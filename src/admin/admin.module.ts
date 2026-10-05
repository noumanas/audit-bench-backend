import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminUsageService } from './admin-usage.service';
import { QuotaModule } from '../quota/quota.module';

@Module({
  imports: [QuotaModule],
  controllers: [AdminController],
  providers: [AdminService, AdminUsageService],
})
export class AdminModule {}
