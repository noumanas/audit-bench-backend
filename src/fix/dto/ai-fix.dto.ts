import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';

export class AiFixDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  path!: string;

  @IsString()
  @MaxLength(2_000_000)
  content!: string;

  // Shape-validated against findingSchema (common/finding.schema.ts) inside
  // FixService.aiFix — this is the same Finding object the frontend already
  // has loaded from the scan, not something a client should be crafting by
  // hand, so a loose object check here is enough at the DTO layer.
  @IsObject()
  finding!: Record<string, unknown>;
}
