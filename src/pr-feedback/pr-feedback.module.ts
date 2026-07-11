import { Module } from '@nestjs/common';
import { PrFeedbackService } from './pr-feedback.service';

@Module({
  providers: [PrFeedbackService],
  exports: [PrFeedbackService],
})
export class PrFeedbackModule {}
