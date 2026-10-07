import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CancelSubscriptionDto {
  @IsOptional()
  @IsBoolean()
  downgrade?: boolean;
}

export class RecordPaymentDto {
  @IsInt()
  @Min(1)
  amountCents: number;

  @IsDateString()
  paidAt: string;

  @IsIn(['subscription', 'tdd_engagement', 'other'])
  kind: 'subscription' | 'tdd_engagement' | 'other';

  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  payerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
