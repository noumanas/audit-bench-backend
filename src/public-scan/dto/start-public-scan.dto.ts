import { IsString, MaxLength, MinLength } from 'class-validator';

export class StartPublicScanDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  repoUrl: string;
}
