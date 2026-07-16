import { IsBoolean } from 'class-validator';

export class UpdateWebhookConfigDto {
  @IsBoolean()
  autoReview!: boolean;
}
