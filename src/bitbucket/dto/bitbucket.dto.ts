import { IsIn, IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'deepseek', 'glm', 'qwen', 'kimi', 'xai', 'mistral', 'minimax'];
const NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export class ConnectBitbucketDto {
  @IsString()
  @MinLength(20, { message: 'That does not look like a valid Bitbucket API token' })
  token!: string;
}

export class ScanBitbucketRepoDto {
  @IsString()
  @Matches(NAME)
  workspace!: string;

  @IsString()
  @Matches(NAME)
  repoSlug!: string;

  @IsOptional()
  @IsString()
  ref?: string;

  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: string;
}

export class ReviewBitbucketPrDto {
  @IsString()
  @Matches(NAME)
  workspace!: string;

  @IsString()
  @Matches(NAME)
  repoSlug!: string;

  @IsInt()
  @Min(1)
  pullId!: number;

  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: string;
}
