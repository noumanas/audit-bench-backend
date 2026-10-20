import { IsBoolean } from 'class-validator';

export class UpdateInstallationDto {
  @IsBoolean()
  autoReview!: boolean;
}
