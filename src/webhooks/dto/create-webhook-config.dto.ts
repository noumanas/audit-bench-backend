import { IsIn, IsString, MinLength } from 'class-validator';

export class CreateWebhookConfigDto {
  @IsIn(['github', 'gitlab'])
  provider!: 'github' | 'gitlab';

  // GitHub: "owner/repo". GitLab: the project id (as a string).
  @IsString()
  @MinLength(1)
  repoIdentifier!: string;
}
