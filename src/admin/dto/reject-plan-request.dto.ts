import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectPlanRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
