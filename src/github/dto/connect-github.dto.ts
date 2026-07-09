import { IsString, MinLength } from 'class-validator';

export class ConnectGithubDto {
  @IsString()
  @MinLength(20, { message: 'That does not look like a valid GitHub token' })
  token: string;
}
