import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'deepseek', 'glm', 'qwen', 'kimi', 'xai', 'mistral', 'minimax'];

export class ScanProjectDto {
  @IsInt()
  @Min(1)
  projectId!: number;

  @IsOptional()
  @IsString()
  ref?: string;

  /** For display only (e.g. "group/project") — the frontend already has this from listProjects(). */
  @IsOptional()
  @IsString()
  projectPath?: string;

  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: string;
}
