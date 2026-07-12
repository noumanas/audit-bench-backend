import { IsString, MinLength } from 'class-validator';

export class ExchangeOAuthDto {
  @IsString()
  @MinLength(1)
  code!: string;
}
