import { IsString, MinLength } from 'class-validator';

export class ConnectGitlabDto {
  @IsString()
  @MinLength(20, { message: 'That does not look like a valid GitLab token' })
  token!: string;
}
