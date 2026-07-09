import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const PROVIDERS = ['anthropic', 'openai', 'gemini'];

export class CreateAuditDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200000)
  code: string;

  @IsOptional()
  @IsString()
  filename?: string;

  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: string;

  @IsOptional()
  @IsString({ each: true })
  focusAreas?: string[];
}
