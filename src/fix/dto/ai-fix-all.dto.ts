import { ArrayMinSize, IsArray, IsObject, IsString, MaxLength, MinLength } from 'class-validator';

export class AiFixAllDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  path!: string;

  @IsString()
  @MaxLength(2_000_000)
  content!: string;

  // Shape-validated per-item against findingSchema inside FixService.aiFixAll.
  @IsArray()
  @ArrayMinSize(1)
  @IsObject({ each: true })
  findings!: Record<string, unknown>[];
}
