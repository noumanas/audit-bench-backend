import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OrgRole, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
export declare class AuthService {
    private readonly prisma;
    private readonly jwt;
    private readonly config;
    constructor(prisma: PrismaService, jwt: JwtService, config: ConfigService);
    signup(dto: SignupDto): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            name: string | null;
            createdAt: Date;
            plan: unknown;
            role: import(".prisma/client").$Enums.Role;
            organization: {
                id: string;
                name: string;
                slug: string;
            } | null;
            orgRole: import(".prisma/client").$Enums.OrgRole | null;
        };
    }>;
    login(dto: LoginDto): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            name: string | null;
            createdAt: Date;
            plan: unknown;
            role: import(".prisma/client").$Enums.Role;
            organization: {
                id: string;
                name: string;
                slug: string;
            } | null;
            orgRole: import(".prisma/client").$Enums.OrgRole | null;
        };
    }>;
    buildSession(user: {
        id: string;
        email: string;
        name: string | null;
        createdAt: Date;
        plan: unknown;
        role: Role;
        isActive: boolean;
        organizationId: string | null;
        orgRole: OrgRole | null;
        organization: {
            id: string;
            name: string;
            slug: string;
        } | null;
    }): {
        accessToken: string;
        user: {
            id: string;
            email: string;
            name: string | null;
            createdAt: Date;
            plan: unknown;
            role: import(".prisma/client").$Enums.Role;
            organization: {
                id: string;
                name: string;
                slug: string;
            } | null;
            orgRole: import(".prisma/client").$Enums.OrgRole | null;
        };
    };
}
