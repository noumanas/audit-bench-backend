import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateWebhookConfigDto {
  @IsIn(['github', 'gitlab'])
  provider!: 'github' | 'gitlab';

  // GitHub: "owner/repo". GitLab: the project id (as a string).
  @IsString()
  @MinLength(1)
  repoIdentifier!: string;

  // Defaults to true — set false to keep only the @auditbench mention chat.
  @IsOptional()
  @IsBoolean()
  autoReview?: boolean;
}
