import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RULE_KINDS, RuleKind } from '../review-rules.service';

export class CreateReviewRuleDto {
  @IsIn(RULE_KINDS)
  kind!: RuleKind;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;

  /** "owner/repo"; omit for every repository. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  repo?: string;

  /** Apply to the whole team rather than just you. */
  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

export class UpdateReviewRuleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text?: string;
}
