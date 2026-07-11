import { IsString, MaxLength, MinLength } from 'class-validator';

export class RecheckFixDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  path!: string;

  @IsString()
  @MaxLength(2_000_000)
  content!: string;
}
