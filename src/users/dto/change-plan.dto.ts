import { IsIn } from 'class-validator';

const PLAN_SLUGS = ['free', 'pro', 'team', 'enterprise'];

export class ChangePlanDto {
  @IsIn(PLAN_SLUGS)
  slug: string;
}
