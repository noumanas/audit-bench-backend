import { Global, Module } from '@nestjs/common';
import { QuotaModule } from '../quota/quota.module';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { UpgradeEmailService } from './upgrade-email.service';
import { InactivityEmailService } from './inactivity-email.service';
import { UnsubscribeService } from './unsubscribe.service';
import { WelcomeEmailService } from './welcome-email.service';

@Global()
@Module({
  imports: [QuotaModule],
  controllers: [EmailController],
  providers: [EmailService, UnsubscribeService, UpgradeEmailService, InactivityEmailService, WelcomeEmailService],
  exports: [EmailService, WelcomeEmailService],
})
export class EmailModule {}
