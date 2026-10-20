import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'deepseek', 'glm', 'qwen', 'kimi', 'xai', 'mistral', 'minimax'];

/** Review any pull request the connected token can read, by its link. */
export class ReviewPrUrlDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  prUrl!: string;

  /** Post the review on the PR as the connected GitHub account. */
  @IsBoolean()
  postToGithub!: boolean;

  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: string;
}
