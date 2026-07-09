import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const PROVIDERS = ['anthropic', 'openai', 'gemini'];

export class ReviewMrDto {
  @IsInt()
  @Min(1)
  projectId!: number;

  @IsInt()
  @Min(1)
  mrIid!: number;

  /** For display only — the frontend already has this from listProjects(). */
  @IsOptional()
  @IsString()
  projectPath?: string;

  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: string;
}
