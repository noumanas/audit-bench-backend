import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';

// Global: auth, OAuth, users and admin all log through it.
@Global()
@Module({
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
