import { Role } from '@prisma/client';
export interface JwtPayload {
    sub: string;
    email: string;
}
export interface RequestUser {
    id: string;
    email: string;
    role: Role;
    organizationId: string | null;
}
