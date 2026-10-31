import { IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AttributionDto } from '../../../activity/attribution';

export class ExchangeOAuthDto {
  @IsString()
  @MinLength(1)
  code!: string;

  // Only used when this sign-in created the account — see ActivityService.recordSignup.
  @IsOptional()
  @ValidateNested()
  @Type(() => AttributionDto)
  attribution?: AttributionDto;
}
