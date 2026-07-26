import { IsIn } from 'class-validator';
import { FINDING_STATUSES, FindingStatus } from '../../common/finding.schema';

export class UpdateFindingStatusDto {
  @IsIn(FINDING_STATUSES)
  status!: FindingStatus;
}
