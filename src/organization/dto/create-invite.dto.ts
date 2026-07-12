import { IsEmail, IsIn } from 'class-validator';
import { OrgRole } from '@prisma/client';

// Owner is granted only by creating the org — never invitable.
const INVITABLE_ROLES: OrgRole[] = ['admin', 'member'];

export class CreateInviteDto {
  @IsEmail()
  email: string;

  @IsIn(INVITABLE_ROLES)
  role: OrgRole;
}
