import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class CompleteConnectDto {
  @IsIn(['github', 'gitlab'])
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  state!: string;
}
