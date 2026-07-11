import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CommitFixDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  path!: string;

  @IsString()
  @MaxLength(2_000_000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
