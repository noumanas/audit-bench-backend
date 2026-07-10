import { IsIn } from 'class-validator';
import { Role } from '@prisma/client';

const ROLES: Role[] = ['user', 'admin', 'super_admin'];

export class UpdateRoleDto {
  @IsIn(ROLES)
  role: Role;
}
