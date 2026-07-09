import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

const PROVIDERS = ['anthropic', 'openai', 'gemini'];

// These are interpolated directly into a GitHub API URL path — restrict to
// characters GitHub itself allows in owner/repo/ref names so a crafted
// value can't produce an unexpected path segment.
const OWNER_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/;

export class ScanRepoDto {
  @IsString()
  @Matches(OWNER_REPO_PATTERN, { message: 'owner contains characters not allowed in a GitHub username/org' })
  owner!: string;

  @IsString()
  @Matches(OWNER_REPO_PATTERN, { message: 'repo contains characters not allowed in a GitHub repository name' })
  repo!: string;

  @IsOptional()
  @IsString()
  @Matches(REF_PATTERN, { message: 'ref contains characters not allowed in a git branch/tag/SHA' })
  ref?: string;

  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: string;
}
