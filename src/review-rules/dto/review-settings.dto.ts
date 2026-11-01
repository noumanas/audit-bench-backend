import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { THRESHOLD_LIMITS as L } from '../../common/review-thresholds';

/** A partial update of a team's review strictness; see common/review-thresholds.ts. */
export class UpdateReviewSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(L.minConfidence.min)
  @Max(L.minConfidence.max)
  minConfidence?: number;

  @IsOptional()
  @IsNumber()
  @Min(L.severeMinConfidence.min)
  @Max(L.severeMinConfidence.max)
  severeMinConfidence?: number;

  @IsOptional()
  @IsInt()
  @Min(L.deepNesting.min)
  @Max(L.deepNesting.max)
  deepNesting?: number;

  @IsOptional()
  @IsInt()
  @Min(L.veryHighComplexity.min)
  @Max(L.veryHighComplexity.max)
  veryHighComplexity?: number;

  @IsOptional()
  @IsBoolean()
  optionalSuggestions?: boolean;
}
