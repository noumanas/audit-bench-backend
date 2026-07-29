import { IsOptional, IsString } from 'class-validator';

export class RunInvestigationDto {
  @IsOptional()
  @IsString()
  provider?: string;
}
