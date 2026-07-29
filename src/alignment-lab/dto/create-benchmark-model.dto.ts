import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const DIFFICULTIES = ['easy', 'medium', 'hard'];

export class CreateBenchmarkModelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  hiddenBehavior: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  personaPrompt: string;

  @IsOptional()
  @IsString()
  @IsIn(DIFFICULTIES)
  difficulty?: string;

  @IsOptional()
  @IsString()
  @IsIn(DIFFICULTIES)
  confessionResistance?: string;
}
