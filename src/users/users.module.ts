import { RevenueModule } from '../revenue/revenue.module';
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { QuotaModule } from '../quota/quota.module';

@Module({
  imports: [RevenueModule, QuotaModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
