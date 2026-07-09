import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

const PROVIDERS = ['anthropic', 'openai', 'gemini'];
const OWNER_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;

export class ReviewPrDto {
  @IsString()
  @Matches(OWNER_REPO_PATTERN, { message: 'owner contains characters not allowed in a GitHub username/org' })
  owner!: string;

  @IsString()
  @Matches(OWNER_REPO_PATTERN, { message: 'repo contains characters not allowed in a GitHub repository name' })
  repo!: string;

  @IsInt()
  @Min(1)
  pullNumber!: number;

  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: string;
}
