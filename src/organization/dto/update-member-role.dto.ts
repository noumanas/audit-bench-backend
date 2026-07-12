import { IsIn } from 'class-validator';
import { OrgRole } from '@prisma/client';

// Ownership transfer isn't supported in this version — only admin/member are settable here.
const ASSIGNABLE_ROLES: OrgRole[] = ['admin', 'member'];

export class UpdateMemberRoleDto {
  @IsIn(ASSIGNABLE_ROLES)
  role: OrgRole;
}
